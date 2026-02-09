import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { toCompilerAgentConfig } from "@/lib/agent-config";
import { toCompilerChannelConfig } from "@/lib/channel-config";
import { prisma } from "@/lib/db";
import { compileRunPlan } from "@/lib/run-compiler";

type RouteContext = {
  params: Promise<{ workspaceSlug: string }>;
};

type CompileRunBody = {
  runId?: unknown;
};

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
    { error: `Failed to compile run plan.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workspaceSlug } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let body: CompileRunBody = {};
    try {
      body = (await request.json()) as CompileRunBody;
    } catch {
      body = {};
    }

    const requestedRunId = normalizeOptionalId(body.runId);
    const run = requestedRunId
      ? await prisma.run.findFirst({
          where: {
            id: requestedRunId,
            workspaceId: workspace.id,
          },
          select: {
            id: true,
            name: true,
            status: true,
            template: true,
          },
        })
      : null;

    if (requestedRunId && !run) {
      return NextResponse.json(
        { error: "Run not found in this workspace." },
        { status: 400 },
      );
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
      runId: run?.id ?? null,
      agents: agents.map((agent) => toCompilerAgentConfig(agent)),
      channels: channels.map((channel) => toCompilerChannelConfig(channel)),
      mounts,
    });

    return NextResponse.json(
      {
        workspace: {
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
        },
        run,
        plan,
      },
      { status: plan.valid ? 200 : 422 },
    );
  } catch (error) {
    return dbFailureResponse(error);
  }
}
