import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { toCompilerAgentConfig } from "@/lib/agent-config";
import { toCompilerChannelConfig } from "@/lib/channel-config";
import { prisma } from "@/lib/db";
import { compileRunPlan } from "@/lib/run-compiler";
import {
  executeRunScheduler,
  resolveSchedulerRuntimeOptions,
  type SchedulerRuntimeOptions,
} from "@/lib/run-scheduler";

type RouteContext = {
  params: Promise<{ workspaceSlug: string; runId: string }>;
};

type ExecuteRunBody = {
  runtime?: unknown;
};

function toPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function dbFailureResponse(error: unknown) {
  const code = toPrismaErrorCode(error);
  const infrastructureCodes = new Set(["P1001"]);
  const schemaMismatchCodes = new Set(["P2021", "P2022"]);

  if (code && infrastructureCodes.has(code)) {
    return NextResponse.json(
      {
        error:
          "Database not ready. Start Postgres, then run `npm run db:migrate:deploy` and `npm run db:seed`.",
      },
      { status: 503 },
    );
  }

  if (code && schemaMismatchCodes.has(code)) {
    return NextResponse.json(
      {
        error:
          "Database schema is behind the app. Run `npm run db:migrate:deploy` then `npm run db:seed`.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: `Failed to execute run.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
}

function parseRuntimeOverrides(value: unknown): Partial<SchedulerRuntimeOptions> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const payload = value as Record<string, unknown>;
  const overrides: Partial<SchedulerRuntimeOptions> = {};

  if (typeof payload.maxRetries === "number") {
    overrides.maxRetries = payload.maxRetries;
  }

  if (typeof payload.turnTimeoutMs === "number") {
    overrides.turnTimeoutMs = payload.turnTimeoutMs;
  }

  if (Array.isArray(payload.transientFailureSequences)) {
    overrides.transientFailureSequences = payload.transientFailureSequences.filter(
      (entry): entry is number => typeof entry === "number",
    );
  }

  if (Array.isArray(payload.timeoutFailureSequences)) {
    overrides.timeoutFailureSequences = payload.timeoutFailureSequences.filter(
      (entry): entry is number => typeof entry === "number",
    );
  }

  return overrides;
}

export async function POST(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workspaceSlug, runId } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const run = await prisma.run.findFirst({
      where: { id: runId, workspaceId: workspace.id },
      select: {
        id: true,
        name: true,
        status: true,
        template: true,
        state: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status === RunStatus.RUNNING) {
      return NextResponse.json(
        { error: "Run is already executing." },
        { status: 409 },
      );
    }

    let body: ExecuteRunBody = {};
    try {
      body = (await request.json()) as ExecuteRunBody;
    } catch {
      body = {};
    }

    const [agents, channels, mounts] = await Promise.all([
      prisma.agent.findMany({
        where: { workspaceId: workspace.id, boardNodeId: { not: null } },
        orderBy: [{ authorityWeight: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          workspaceId: true,
          boardNodeId: true,
          name: true,
          role: true,
          objective: true,
          authorityWeight: true,
          thinkingProfile: true,
          privateMemoryEnabled: true,
          metadata: true,
          persona: true,
          constraints: true,
          updatedAt: true,
        },
      }),
      prisma.channel.findMany({
        where: { workspaceId: workspace.id, boardEdgeId: { not: null } },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          boardEdgeId: true,
          workspaceId: true,
          name: true,
          sourceAgentId: true,
          targetAgentId: true,
          visibility: true,
          allowedMessageTypes: true,
          writerAgentIds: true,
          readerAgentIds: true,
          metadata: true,
          updatedAt: true,
        },
      }),
      prisma.mount.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          scope: true,
          runId: true,
          agentId: true,
          channelId: true,
          vaultItem: {
            select: {
              id: true,
              name: true,
              fileName: true,
              mimeType: true,
              byteSize: true,
              storageKey: true,
              tags: true,
            },
          },
        },
      }),
    ]);

    const plan = compileRunPlan({
      workspaceId: workspace.id,
      runId: run.id,
      agents: agents.map((agent) => toCompilerAgentConfig(agent)),
      channels: channels.map((channel) => toCompilerChannelConfig(channel)),
      mounts,
    });

    if (!plan.valid) {
      return NextResponse.json(
        {
          error: "Run compiler blocked execution. Fix blocking issues before running.",
          plan,
        },
        { status: 422 },
      );
    }

    const runtimeOptions = resolveSchedulerRuntimeOptions(
      run.state,
      parseRuntimeOverrides(body.runtime),
    );

    const execution = await executeRunScheduler({
      db: prisma,
      workspaceId: workspace.id,
      runId: run.id,
      plan,
      runtimeOptions,
    });

    const updatedRun = await prisma.run.findFirst({
      where: {
        id: run.id,
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        name: true,
        status: true,
        template: true,
        startedAt: true,
        endedAt: true,
        state: true,
        turns: {
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            sequence: true,
            status: true,
            error: true,
            startedAt: true,
            endedAt: true,
            actorAgent: { select: { id: true, name: true } },
            channel: { select: { id: true, name: true } },
          },
          take: 120,
        },
      },
    });

    return NextResponse.json({
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
      },
      run: updatedRun,
      execution,
      runtimeOptions,
      planSummary: {
        generatedAt: plan.generatedAt,
        turnCandidateCount: plan.turnCandidates.length,
        stopConditionCount: plan.stopConditions.length,
      },
    });
  } catch (error) {
    return dbFailureResponse(error);
  }
}
