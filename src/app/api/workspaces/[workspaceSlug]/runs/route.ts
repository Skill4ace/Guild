import {
  AgentRole,
  PolicyKind,
  PolicyScope,
  Prisma,
  RunStatus,
  RunTemplate,
  VoteStatus,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import {
  DEFAULT_SCHEDULER_RUNTIME_OPTIONS,
  resolveSchedulerRuntimeOptions,
} from "@/lib/run-scheduler";

type RouteContext = {
  params: Promise<{ workspaceSlug: string }>;
};

type CreateRunBody = {
  name?: unknown;
  template?: unknown;
  runtime?: unknown;
  governanceHarness?: unknown;
  objective?: unknown;
};

function toPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function dbFailureResponse(error: unknown, action: "load" | "create") {
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
    { error: `Failed to ${action} runs.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : null;
}

function parseRunTemplate(value: unknown): RunTemplate {
  if (value === RunTemplate.DEBATE) return RunTemplate.DEBATE;
  if (value === RunTemplate.ORG) return RunTemplate.ORG;
  if (value === RunTemplate.GAME) return RunTemplate.GAME;
  return RunTemplate.CUSTOM;
}

type GovernanceHarnessKind = "baseline" | null;

function parseGovernanceHarness(value: unknown): GovernanceHarnessKind {
  if (value === "baseline" || value === "module14") {
    return "baseline";
  }

  return null;
}

function normalizeObjective(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, 400);
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoardObjectiveFromViewport(viewport: unknown): string | null {
  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) {
    return null;
  }

  return normalizeObjective((viewport as Record<string, unknown>).objective);
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

function parseCheckpoint(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

function parseRunProvenance(value: unknown): {
  sourceRunId: string;
  sourceRunName: string | null;
  sourceWorkspaceId: string | null;
  sourceCheckpointSequence: number;
  sourceCheckpointTurnId: string | null;
  sourceTurnCount: number;
  sourceRunStatus: string | null;
  sourceUpdatedAt: string | null;
  forkedAt: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const sourceRunId =
    typeof payload.sourceRunId === "string" ? payload.sourceRunId : null;
  const sourceCheckpointSequence = parseNonNegativeInt(
    payload.sourceCheckpointSequence,
  );
  const forkedAt =
    typeof payload.forkedAt === "string" ? payload.forkedAt : null;

  if (!sourceRunId || sourceCheckpointSequence === null || !forkedAt) {
    return null;
  }

  return {
    sourceRunId,
    sourceRunName:
      typeof payload.sourceRunName === "string" ? payload.sourceRunName : null,
    sourceWorkspaceId:
      typeof payload.sourceWorkspaceId === "string"
        ? payload.sourceWorkspaceId
        : null,
    sourceCheckpointSequence,
    sourceCheckpointTurnId:
      typeof payload.sourceCheckpointTurnId === "string"
        ? payload.sourceCheckpointTurnId
        : null,
    sourceTurnCount: parseNonNegativeInt(payload.sourceTurnCount) ?? 0,
    sourceRunStatus:
      typeof payload.sourceRunStatus === "string"
        ? payload.sourceRunStatus
        : null,
    sourceUpdatedAt:
      typeof payload.sourceUpdatedAt === "string"
        ? payload.sourceUpdatedAt
        : null,
    forkedAt,
  };
}

function parseTurnOutput(value: unknown): {
  model: string | null;
  routeReason: string | null;
  thinkingLevel: string | null;
  latencyMs: number | null;
  schema: string | null;
  validationStatus: string | null;
  validationIssues: string[];
  repairSteps: string[];
  payload: Record<string, unknown> | null;
  tokenUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  summary: string | null;
  messageType: string | null;
  toolSummary: {
    requested: number;
    executed: number;
    blocked: number;
    invalid: number;
  };
  toolCalls: Array<{
    tool: string;
    status: string;
    blockCode: string | null;
    message: string | null;
  }>;
  governance: {
    status: string | null;
    blockingPolicyIds: string[];
    reasons: string[];
    escalationNote: string | null;
  };
  consensus: {
    voteId: string | null;
    castOption: string | null;
    status: string | null;
    outcome: string | null;
    winner: string | null;
    explanation: string | null;
    quorumReached: boolean | null;
    thresholdReached: boolean | null;
    tie: boolean | null;
    voterCount: number | null;
    leadingOption: string | null;
    finalizedOpenVotes: number;
  };
  deadlock: {
    status: string;
    signals: string[];
    action: string | null;
    note: string | null;
  };
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      model: null,
      routeReason: null,
      thinkingLevel: null,
      latencyMs: null,
      schema: null,
      validationStatus: null,
      validationIssues: [],
      repairSteps: [],
      payload: null,
      tokenUsage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
      summary: null,
      messageType: null,
      toolSummary: {
        requested: 0,
        executed: 0,
        blocked: 0,
        invalid: 0,
      },
      toolCalls: [],
      governance: {
        status: null,
        blockingPolicyIds: [],
        reasons: [],
        escalationNote: null,
      },
      consensus: {
        voteId: null,
        castOption: null,
        status: null,
        outcome: null,
        winner: null,
        explanation: null,
        quorumReached: null,
        thresholdReached: null,
        tie: null,
        voterCount: null,
        leadingOption: null,
        finalizedOpenVotes: 0,
      },
      deadlock: {
        status: "none",
        signals: [],
        action: null,
        note: null,
      },
    };
  }

  const payload = value as Record<string, unknown>;
  const tokens =
    payload.tokens && typeof payload.tokens === "object" && !Array.isArray(payload.tokens)
      ? (payload.tokens as Record<string, unknown>)
      : {};
  const rawValidationIssues = Array.isArray(payload.validationIssues)
    ? payload.validationIssues
    : [];
  const validationIssues = rawValidationIssues
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const issue = entry as Record<string, unknown>;
      const path = typeof issue.path === "string" ? issue.path : "$";
      const code = typeof issue.code === "string" ? issue.code : "UNKNOWN";
      return `${code} at ${path}`;
    })
    .filter((entry): entry is string => entry !== null);
  const repairSteps = Array.isArray(payload.repairSteps)
    ? payload.repairSteps
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 6)
    : [];
  const parsedPayload =
    payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
      ? (payload.payload as Record<string, unknown>)
      : null;
  const toolSummaryPayload =
    payload.toolSummary &&
    typeof payload.toolSummary === "object" &&
    !Array.isArray(payload.toolSummary)
      ? (payload.toolSummary as Record<string, unknown>)
      : {};
  const toolCalls = Array.isArray(payload.toolCalls)
    ? payload.toolCalls
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }

          const event = entry as Record<string, unknown>;
          const tool = typeof event.tool === "string" ? event.tool : "unknown";
          const status = typeof event.status === "string" ? event.status : "unknown";
          return {
            tool,
            status,
            blockCode:
              typeof event.blockCode === "string" ? event.blockCode : null,
            message: typeof event.message === "string" ? event.message : null,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            tool: string;
            status: string;
            blockCode: string | null;
            message: string | null;
          } => entry !== null,
        )
        .slice(0, 12)
    : [];
  const governancePayload =
    payload.governance &&
    typeof payload.governance === "object" &&
    !Array.isArray(payload.governance)
      ? (payload.governance as Record<string, unknown>)
      : {};
  const blockingPolicyIds = Array.isArray(governancePayload.blockingPolicyIds)
    ? governancePayload.blockingPolicyIds
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 20)
    : [];
  const governanceReasons = Array.isArray(governancePayload.reasons)
    ? governancePayload.reasons
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 8)
    : [];
  const escalationPayload =
    governancePayload.escalation &&
    typeof governancePayload.escalation === "object" &&
    !Array.isArray(governancePayload.escalation)
      ? (governancePayload.escalation as Record<string, unknown>)
      : {};
  const consensusPayload =
    payload.consensus &&
    typeof payload.consensus === "object" &&
    !Array.isArray(payload.consensus)
      ? (payload.consensus as Record<string, unknown>)
      : {};
  const deadlockPayload =
    payload.deadlock &&
    typeof payload.deadlock === "object" &&
    !Array.isArray(payload.deadlock)
      ? (payload.deadlock as Record<string, unknown>)
      : {};
  const deadlockSignals = Array.isArray(deadlockPayload.signals)
    ? deadlockPayload.signals
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 6)
    : [];

  return {
    model: typeof payload.model === "string" ? payload.model : null,
    routeReason:
      typeof payload.routeReason === "string" ? payload.routeReason : null,
    thinkingLevel:
      typeof payload.thinkingLevel === "string" ? payload.thinkingLevel : null,
    latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : null,
    schema: typeof payload.schema === "string" ? payload.schema : null,
    validationStatus:
      typeof payload.validationStatus === "string"
        ? payload.validationStatus
        : null,
    validationIssues,
    repairSteps,
    payload: parsedPayload,
    tokenUsage: {
      inputTokens:
        typeof tokens.inputTokens === "number" ? tokens.inputTokens : null,
      outputTokens:
        typeof tokens.outputTokens === "number" ? tokens.outputTokens : null,
      totalTokens:
        typeof tokens.totalTokens === "number" ? tokens.totalTokens : null,
    },
    summary: typeof payload.summary === "string" ? payload.summary : null,
    messageType:
      typeof payload.messageType === "string" ? payload.messageType : null,
    toolSummary: {
      requested:
        typeof toolSummaryPayload.requested === "number"
          ? toolSummaryPayload.requested
          : toolCalls.length,
      executed:
        typeof toolSummaryPayload.executed === "number"
          ? toolSummaryPayload.executed
          : toolCalls.filter((entry) => entry.status === "executed").length,
      blocked:
        typeof toolSummaryPayload.blocked === "number"
          ? toolSummaryPayload.blocked
          : toolCalls.filter((entry) => entry.status === "blocked").length,
      invalid:
        typeof toolSummaryPayload.invalid === "number"
          ? toolSummaryPayload.invalid
          : toolCalls.filter((entry) => entry.status === "invalid").length,
    },
    toolCalls,
    governance: {
      status:
        typeof governancePayload.status === "string"
          ? governancePayload.status
          : null,
      blockingPolicyIds,
      reasons: governanceReasons,
      escalationNote:
        typeof escalationPayload.note === "string" ? escalationPayload.note : null,
    },
    consensus: {
      voteId:
        typeof consensusPayload.voteId === "string"
          ? consensusPayload.voteId
          : null,
      castOption:
        typeof consensusPayload.castOption === "string"
          ? consensusPayload.castOption
          : null,
      status:
        typeof consensusPayload.status === "string"
          ? consensusPayload.status
          : null,
      outcome:
        typeof consensusPayload.outcome === "string"
          ? consensusPayload.outcome
          : null,
      winner:
        typeof consensusPayload.winner === "string"
          ? consensusPayload.winner
          : null,
      explanation:
        typeof consensusPayload.explanation === "string"
          ? consensusPayload.explanation
          : null,
      quorumReached:
        typeof consensusPayload.quorumReached === "boolean"
          ? consensusPayload.quorumReached
          : null,
      thresholdReached:
        typeof consensusPayload.thresholdReached === "boolean"
          ? consensusPayload.thresholdReached
          : null,
      tie:
        typeof consensusPayload.tie === "boolean"
          ? consensusPayload.tie
          : null,
      voterCount:
        typeof consensusPayload.voterCount === "number"
          ? consensusPayload.voterCount
          : null,
      leadingOption:
        typeof consensusPayload.leadingOption === "string"
          ? consensusPayload.leadingOption
          : null,
      finalizedOpenVotes:
        typeof consensusPayload.finalizedOpenVotes === "number"
          ? consensusPayload.finalizedOpenVotes
          : 0,
    },
    deadlock: {
      status:
        typeof deadlockPayload.status === "string"
          ? deadlockPayload.status
          : "none",
      signals: deadlockSignals,
      action:
        typeof deadlockPayload.action === "string"
          ? deadlockPayload.action
          : null,
      note:
        typeof deadlockPayload.note === "string"
          ? deadlockPayload.note
          : null,
    },
  };
}

function parseVoteResult(value: unknown): {
  outcome: string | null;
  winner: string | null;
  explanation: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      outcome: null,
      winner: null,
      explanation: null,
    };
  }

  const payload = value as Record<string, unknown>;
  return {
    outcome: typeof payload.outcome === "string" ? payload.outcome : null,
    winner: typeof payload.winner === "string" ? payload.winner : null,
    explanation:
      typeof payload.explanation === "string" ? payload.explanation : null,
  };
}

export async function GET(request: Request, context: RouteContext) {
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

    const [runs, boardState] = await Promise.all([
      prisma.run.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          status: true,
          template: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          updatedAt: true,
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
              output: true,
              actorAgent: { select: { id: true, name: true } },
              channel: { select: { id: true, name: true } },
            },
            take: 80,
          },
          votes: {
            orderBy: [{ updatedAt: "desc" }, { openedAt: "desc" }],
            select: {
              id: true,
              status: true,
              question: true,
              quorum: true,
              threshold: true,
              result: true,
              openedAt: true,
              closedAt: true,
              updatedAt: true,
            },
            take: 20,
          },
        },
        take: 30,
      }),
      prisma.boardState.findUnique({
        where: { workspaceId: workspace.id },
        select: { viewport: true },
      }),
    ]);

    return NextResponse.json({
      workspace: {
        ...workspace,
        defaultObjective: parseBoardObjectiveFromViewport(boardState?.viewport),
      },
      runs: runs.map((run) => {
        const state =
          run.state && typeof run.state === "object" && !Array.isArray(run.state)
            ? (run.state as Record<string, unknown>)
            : {};
        const checkpoint = parseCheckpoint(state.schedulerCheckpoint);
        const provenance = parseRunProvenance(state.fork);
        const counts = run.turns.reduce(
          (accumulator, turn) => {
            accumulator.total += 1;
            if (turn.status === "QUEUED") accumulator.queued += 1;
            if (turn.status === "RUNNING") accumulator.running += 1;
            if (turn.status === "BLOCKED" || turn.status === "FAILED") {
              accumulator.blocked += 1;
            }
            if (turn.status === "COMPLETED" || turn.status === "SKIPPED") {
              accumulator.done += 1;
            }

            return accumulator;
          },
          {
            total: 0,
            queued: 0,
            running: 0,
            blocked: 0,
            done: 0,
          },
        );
        const voteCounts = run.votes.reduce(
          (accumulator, vote) => {
            accumulator.total += 1;
            if (vote.status === "OPEN") accumulator.open += 1;
            if (vote.status === "CLOSED") accumulator.closed += 1;
            if (vote.status === "CANCELED") accumulator.canceled += 1;
            return accumulator;
          },
          {
            total: 0,
            open: 0,
            closed: 0,
            canceled: 0,
          },
        );
        const latestVote = run.votes[0] ?? null;
        const latestVoteResult = latestVote
          ? parseVoteResult(latestVote.result)
          : { outcome: null, winner: null, explanation: null };
        const parsedTurns = run.turns.map((turn) => ({
          id: turn.id,
          sequence: turn.sequence,
          status: turn.status,
          error: turn.error,
          startedAt: turn.startedAt,
          endedAt: turn.endedAt,
          output: parseTurnOutput(turn.output),
          actor: turn.actorAgent,
          channel: turn.channel,
        }));
        const latestDeadlockTurn = [...parsedTurns]
          .reverse()
          .find((turn) => turn.output?.deadlock.status !== "none");

        return {
          id: run.id,
          name: run.name,
          objective: parseRunObjective(run.state),
          status: run.status,
          template: run.template,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          checkpoint,
          provenance,
          counts,
          votes: {
            counts: voteCounts,
            latest: latestVote
              ? {
                  id: latestVote.id,
                  status: latestVote.status,
                  question: latestVote.question,
                  quorum: latestVote.quorum,
                  threshold: latestVote.threshold,
                  outcome: latestVoteResult.outcome,
                  winner: latestVoteResult.winner,
                  explanation: latestVoteResult.explanation,
                  openedAt: latestVote.openedAt,
                  closedAt: latestVote.closedAt,
                  updatedAt: latestVote.updatedAt,
                }
              : null,
          },
          deadlock: latestDeadlockTurn
            ? {
                status: latestDeadlockTurn.output?.deadlock.status ?? "none",
                action: latestDeadlockTurn.output?.deadlock.action ?? null,
                note: latestDeadlockTurn.output?.deadlock.note ?? null,
                signals: latestDeadlockTurn.output?.deadlock.signals ?? [],
                turnSequence: latestDeadlockTurn.sequence,
              }
            : null,
          turns: parsedTurns,
        };
      }),
    });
  } catch (error) {
    return dbFailureResponse(error, "load");
  }
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
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let body: CreateRunBody = {};
    try {
      body = (await request.json()) as CreateRunBody;
    } catch {
      body = {};
    }

    const name = normalizeName(body.name);
    const template = parseRunTemplate(body.template);
    const governanceHarness = parseGovernanceHarness(body.governanceHarness);
    const runtimeOptions = resolveSchedulerRuntimeOptions(
      { schedulerRuntime: DEFAULT_SCHEDULER_RUNTIME_OPTIONS },
      body.runtime as Partial<typeof DEFAULT_SCHEDULER_RUNTIME_OPTIONS>,
    );

    const boardState = await prisma.boardState.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        nodes: true,
        edges: true,
        viewport: true,
      },
    });
    const runObjective =
      normalizeObjective(body.objective) ??
      parseBoardObjectiveFromViewport(boardState?.viewport);

    const run = await prisma.run.create({
      data: {
        workspaceId: workspace.id,
        name,
        template,
        status: RunStatus.DRAFT,
        boardSnapshot: boardState
          ? {
              nodes: boardState.nodes,
              edges: boardState.edges,
            }
          : Prisma.DbNull,
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
            note: "Draft created.",
            updatedAt: new Date().toISOString(),
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

    if (governanceHarness === "baseline") {
      await prisma.policy.createMany({
        data: [
          {
            workspaceId: workspace.id,
            runId: run.id,
            name: "Baseline Approval Gate",
            kind: PolicyKind.APPROVAL,
            scope: PolicyScope.RUN,
            config: {
              requiredRoles: [AgentRole.EXECUTIVE, AgentRole.SPECIALIST],
              approvalMessageTypes: ["proposal", "critique", "vote_call", "decision"],
              minApprovalWeight: 7,
              decisionOnly: true,
              action: "baseline_block_until_cross_role_approval",
            },
          },
          {
            workspaceId: workspace.id,
            runId: run.id,
            name: "Baseline Escalation",
            kind: PolicyKind.ESCALATION,
            scope: PolicyScope.RUN,
            config: {
              blockedTurnThreshold: 0,
              note: "Escalation triggered by baseline governance harness.",
            },
          },
        ],
      });

      await prisma.vote.create({
        data: {
          workspaceId: workspace.id,
          runId: run.id,
          question: "Baseline vote: approve this plan?",
          status: VoteStatus.OPEN,
          quorum: 2,
          threshold: 20,
          options: ["approve", "revise", "reject"],
          weights: {},
          ballots: {},
        },
      });
    }

    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return dbFailureResponse(error, "create");
  }
}
