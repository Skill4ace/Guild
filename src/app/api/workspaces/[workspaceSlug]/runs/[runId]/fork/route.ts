import { Prisma, RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import { buildForkRunName, resolveForkCheckpoint } from "@/lib/run-fork";
import {
  DEFAULT_SCHEDULER_RUNTIME_OPTIONS,
  resolveSchedulerRuntimeOptions,
} from "@/lib/run-scheduler";

type RouteContext = {
  params: Promise<{ workspaceSlug: string; runId: string }>;
};

type ForkRunBody = {
  name?: unknown;
  checkpointSequence?: unknown;
};

function normalizeObjective(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, 400);
  return trimmed.length > 0 ? trimmed : null;
}

function parseRunObjective(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const payload = state as Record<string, unknown>;
  const direct = normalizeObjective(payload.runObjective);
  if (direct) {
    return direct;
  }

  const template =
    payload.template && typeof payload.template === "object" && !Array.isArray(payload.template)
      ? (payload.template as Record<string, unknown>)
      : null;

  return normalizeObjective(template?.objective);
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
    { error: `Failed to fork run.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
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

    const sourceRun = await prisma.run.findFirst({
      where: {
        id: runId,
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        name: true,
        template: true,
        status: true,
        state: true,
        boardSnapshot: true,
        updatedAt: true,
        turns: {
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            sequence: true,
          },
        },
      },
    });

    if (!sourceRun) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    let body: ForkRunBody = {};
    try {
      body = (await request.json()) as ForkRunBody;
    } catch {
      body = {};
    }

    const checkpoint = resolveForkCheckpoint({
      turns: sourceRun.turns,
      requestedSequence:
        typeof body.checkpointSequence === "number"
          ? body.checkpointSequence
          : null,
    });

    const runtimeOptions = resolveSchedulerRuntimeOptions(
      sourceRun.state ?? { schedulerRuntime: DEFAULT_SCHEDULER_RUNTIME_OPTIONS },
      {},
    );
    const runName = buildForkRunName({
      explicitName: typeof body.name === "string" ? body.name : null,
      sourceRunName: sourceRun.name,
      checkpointSequence: checkpoint.checkpointSequence,
    });
    const runObjective = parseRunObjective(sourceRun.state);
    const forkedAt = new Date().toISOString();

    const run = await prisma.run.create({
      data: {
        workspaceId: workspace.id,
        name: runName,
        template: sourceRun.template,
        status: RunStatus.DRAFT,
        boardSnapshot: sourceRun.boardSnapshot ?? Prisma.DbNull,
        state: {
          runObjective,
          schedulerRuntime: runtimeOptions,
          schedulerCheckpoint: {
            lastTurnId: null,
            lastSequence: 0,
            queueDepth: 0,
            completedTurns: 0,
            blockedTurns: 0,
            skippedTurns: 0,
            retriesUsed: 0,
            processedAttempts: 0,
            note: `Fork created from run ${sourceRun.id} at T${checkpoint.checkpointSequence}.`,
            updatedAt: forkedAt,
          },
          fork: {
            sourceRunId: sourceRun.id,
            sourceRunName: sourceRun.name,
            sourceWorkspaceId: workspace.id,
            sourceCheckpointSequence: checkpoint.checkpointSequence,
            sourceCheckpointTurnId: checkpoint.checkpointTurnId,
            sourceTurnCount: sourceRun.turns.length,
            sourceRunStatus: sourceRun.status,
            sourceUpdatedAt: sourceRun.updatedAt.toISOString(),
            forkedAt,
          },
          replaySeed: {
            checkpointSequence: checkpoint.checkpointSequence,
            sourceRunId: sourceRun.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        status: true,
        template: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        run,
        provenance: {
          sourceRunId: sourceRun.id,
          sourceRunName: sourceRun.name,
          sourceCheckpointSequence: checkpoint.checkpointSequence,
          sourceCheckpointTurnId: checkpoint.checkpointTurnId,
          sourceTurnCount: sourceRun.turns.length,
          sourceRunStatus: sourceRun.status,
          forkedAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return dbFailureResponse(error);
  }
}
