import {
  Prisma,
  RunStatus,
  TurnStatus,
  VoteStatus,
  type PrismaClient,
} from "@prisma/client";

import { DEFAULT_BOARD_OBJECTIVE, type ChannelMessageType } from "./board-state";
import { toCompilerChannelConfig } from "./channel-config";
import {
  evaluateDeadlockMediation,
  type DeadlockHistoryTurn,
  type DeadlockMediationEvaluation,
  type DeadlockMediationStatus,
  type MediatorAction,
} from "./deadlock-mediation";
import {
  evaluateGovernanceForTurn,
  normalizeGovernancePolicies,
  type GovernanceActorProfile,
  type GovernanceEvaluation,
  type GovernanceTurnRecord,
} from "./governance-engine";
import { resolveMountContextFromMounts } from "./mount-manager";
import type { CompiledRunPlan, CompiledTurnCandidate } from "./run-compiler";
import {
  executeGeminiTurn,
  generateGeminiImageArtifact,
  selectGeminiModel,
  synthesizeGeminiFinalDraft,
  type GeminiPromptContextWindow,
  type GeminiTurnTelemetry,
} from "./gemini-client";
import type {
  AgentActOutput,
  StructuredValidationIssue,
} from "./structured-output";
import { buildFallbackAgentActOutput } from "./structured-output";
import {
  buildDefaultToolCallsForTurn,
  executeToolGatewayBatch,
  type ToolGatewayCallEvent,
  type ToolGatewaySummary,
} from "./tool-gateway";
import { createVaultStorageKey } from "./vault";
import { deleteVaultBuffer, writeVaultBuffer } from "./vault-storage";
import {
  chooseDeterministicVoteOption,
  normalizeVoteOptions,
  resolveVoteResult,
} from "./vote-engine";

export type SchedulerRuntimeOptions = {
  maxRetries: number;
  turnTimeoutMs: number;
  transientFailureSequences: number[];
  timeoutFailureSequences: number[];
};

export type SchedulerCheckpoint = {
  lastTurnId: string | null;
  lastSequence: number;
  queueDepth: number;
  completedTurns: number;
  blockedTurns: number;
  skippedTurns: number;
  retriesUsed: number;
  processedAttempts: number;
  note: string;
  updatedAt: string;
};

export type RunSchedulerResult = {
  runId: string;
  status: "completed" | "blocked";
  processedAttempts: number;
  completedTurns: number;
  blockedTurns: number;
  skippedTurns: number;
  retriesUsed: number;
  decisionReached: boolean;
  checkpoint: SchedulerCheckpoint;
  deadlock: {
    status: DeadlockMediationStatus;
    action: MediatorAction | null;
    note: string | null;
    signals: string[];
  };
};

export const DEFAULT_SCHEDULER_RUNTIME_OPTIONS: SchedulerRuntimeOptions = {
  maxRetries: 2,
  turnTimeoutMs: 30000,
  transientFailureSequences: [],
  timeoutFailureSequences: [],
};

type RunRecord = {
  id: string;
  name: string | null;
  workspaceId: string;
  status: RunStatus;
  startedAt: Date | null;
  state: Prisma.JsonValue | null;
};

type TurnRecord = {
  id: string;
  sequence: number;
  status: TurnStatus;
  actorAgentId: string | null;
  channelId: string | null;
  input: Prisma.JsonValue | null;
};

type ExecuteRunSchedulerInput = {
  db: PrismaClient;
  workspaceId: string;
  runId: string;
  plan: CompiledRunPlan;
  runtimeOptions: SchedulerRuntimeOptions;
};

type SimulatedTurnOutput = {
  engine: "gemini";
  messageType: ChannelMessageType;
  summary: string;
  rationale: string;
  confidence: number;
  candidateId: string;
  channelId: string;
  sourceAgentId: string;
  targetAgentId: string;
  mountItemCount: number;
  prompt: string;
  model: string;
  routeReason: string;
  thinkingLevel: GeminiTurnTelemetry["thinkingLevel"];
  latencyMs: number;
  tokens: GeminiTurnTelemetry["tokenUsage"];
  schema: AgentActOutput["schema"];
  payload: AgentActOutput["payload"];
  validationStatus: "valid" | "repaired" | "fallback";
  validationIssues: StructuredValidationIssue[];
  repairSteps: string[];
  normalizedOutput: {
    messageType: ChannelMessageType;
    summary: string;
    rationale: string;
    confidence: number;
  };
  requestLog: {
    prompt: string;
    model: string;
    routeReason: string;
  };
  responseLog: {
    rawResponseText: string;
    source: GeminiTurnTelemetry["source"];
    statusCode: number | null;
  };
  governance?: GovernanceEvaluation;
  consensus?: {
    voteId: string | null;
    castOption: string | null;
    status: "OPEN" | "CLOSED" | null;
    outcome: "passed" | "no_consensus" | null;
    winner: string | null;
    explanation: string | null;
    quorumReached: boolean | null;
    thresholdReached: boolean | null;
    tie: boolean | null;
    voterCount: number | null;
    leadingOption: string | null;
    finalizedOpenVotes: number;
  };
  deadlock?: {
    status: DeadlockMediationStatus;
    signals: string[];
    action: MediatorAction | null;
    note: string | null;
  };
  artifacts?: Array<{
    kind: "image";
    vaultItemId: string;
    name: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    model: string;
  }>;
  toolCalls?: ToolGatewayCallEvent[];
  toolSummary?: ToolGatewaySummary;
  toolEffects?: {
    voteIds: string[];
    checkpointLabels: string[];
    requestedRunStatus: string | null;
  };
  processedAt: string;
};

type ConversationHistoryEntry = {
  sequence: number;
  channelId: string;
  sourceAgentId: string;
  sourceAgentName: string;
  targetAgentId: string;
  targetAgentName: string;
  messageType: ChannelMessageType;
  summary: string;
  confidence: number | null;
};

export type SchedulerTurnErrorCode =
  | "TRANSIENT_RUNTIME"
  | "TURN_TIMEOUT"
  | "CANDIDATE_NOT_FOUND"
  | "CHANNEL_POLICY_MISSING";

export class SchedulerTurnError extends Error {
  code: SchedulerTurnErrorCode;
  retryable: boolean;

  constructor(code: SchedulerTurnErrorCode, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "SchedulerTurnError";
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeSequenceList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed = value
    .map((entry) => clampInt(entry, 1, 500, -1))
    .filter((entry) => entry > 0);

  return parsed.filter(
    (entry, index, collection) => collection.indexOf(entry) === index,
  );
}

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseAttemptCount(input: Prisma.JsonValue | null): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return 0;
  }

  const attempt = (input as Record<string, unknown>).attempt;
  return clampInt(attempt, 0, 100, 0);
}

function parseCandidateIdFromInput(input: Prisma.JsonValue | null): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidateId = (input as Record<string, unknown>).candidateId;
  if (typeof candidateId !== "string") {
    return null;
  }

  const trimmed = candidateId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOutputMessageType(output: Prisma.JsonValue | null): ChannelMessageType | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const value = (output as Record<string, unknown>).messageType;
  if (value === "proposal") return value;
  if (value === "critique") return value;
  if (value === "vote_call") return value;
  if (value === "decision") return value;
  return null;
}

function parseOutputSummary(output: Prisma.JsonValue | null): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const payload = output as Record<string, unknown>;
  const direct = payload.summary;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim().slice(0, 260);
  }

  const normalizedOutput =
    payload.normalizedOutput &&
    typeof payload.normalizedOutput === "object" &&
    !Array.isArray(payload.normalizedOutput)
      ? (payload.normalizedOutput as Record<string, unknown>)
      : null;
  const normalizedSummary = normalizedOutput?.summary;
  if (
    typeof normalizedSummary === "string" &&
    normalizedSummary.trim().length > 0
  ) {
    return normalizedSummary.trim().slice(0, 260);
  }

  return null;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }

  return ".png";
}

function parseOutputConfidence(output: Prisma.JsonValue | null): number | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const payload = output as Record<string, unknown>;
  const direct = payload.confidence;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return Math.max(0, Math.min(1, direct));
  }

  const normalizedOutput =
    payload.normalizedOutput &&
    typeof payload.normalizedOutput === "object" &&
    !Array.isArray(payload.normalizedOutput)
      ? (payload.normalizedOutput as Record<string, unknown>)
      : null;
  const normalizedConfidence = normalizedOutput?.confidence;
  if (
    typeof normalizedConfidence === "number" &&
    Number.isFinite(normalizedConfidence)
  ) {
    return Math.max(0, Math.min(1, normalizedConfidence));
  }

  return null;
}

function parseOutputRationale(output: Prisma.JsonValue | null): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const payload = output as Record<string, unknown>;
  const direct = payload.rationale;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim().slice(0, 360);
  }

  const normalizedOutput =
    payload.normalizedOutput &&
    typeof payload.normalizedOutput === "object" &&
    !Array.isArray(payload.normalizedOutput)
      ? (payload.normalizedOutput as Record<string, unknown>)
      : null;
  const normalizedRationale = normalizedOutput?.rationale;
  if (
    typeof normalizedRationale === "string" &&
    normalizedRationale.trim().length > 0
  ) {
    return normalizedRationale.trim().slice(0, 360);
  }

  return null;
}

function parseOutputPayload(output: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const payload = (output as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return payload as Record<string, unknown>;
}

function parseOutputArtifacts(
  output: Prisma.JsonValue | null,
): Array<{
  kind: string;
  vaultItemId: string;
  name: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  model: string | null;
}> {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [];
  }

  const artifacts = (output as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts)) {
    return [];
  }

  return artifacts
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const artifact = entry as Record<string, unknown>;
      const kind = typeof artifact.kind === "string" ? artifact.kind : "asset";
      const vaultItemId =
        typeof artifact.vaultItemId === "string" ? artifact.vaultItemId : null;
      const name = typeof artifact.name === "string" ? artifact.name : null;
      const fileName = typeof artifact.fileName === "string" ? artifact.fileName : null;
      const mimeType = typeof artifact.mimeType === "string" ? artifact.mimeType : null;
      const byteSize =
        typeof artifact.byteSize === "number" && Number.isFinite(artifact.byteSize)
          ? Math.max(0, Math.round(artifact.byteSize))
          : null;

      if (!vaultItemId || !name || !fileName || !mimeType || byteSize === null) {
        return null;
      }

      return {
        kind,
        vaultItemId,
        name,
        fileName,
        mimeType,
        byteSize,
        model: typeof artifact.model === "string" ? artifact.model : null,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        kind: string;
        vaultItemId: string;
        name: string;
        fileName: string;
        mimeType: string;
        byteSize: number;
        model: string | null;
      } => entry !== null,
    );
}

function parseVoteResult(
  value: Prisma.JsonValue | null,
): {
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

function buildConversationContextWindow(input: {
  history: ConversationHistoryEntry[];
  candidate: CompiledTurnCandidate;
}): GeminiPromptContextWindow {
  const reverseChronological = [...input.history].sort(
    (a, b) => b.sequence - a.sequence,
  );
  const pickRecent = (entries: ConversationHistoryEntry[], limit: number) =>
    entries
      .slice(0, limit)
      .sort((a, b) => a.sequence - b.sequence)
      .map((entry) => ({
        sequence: entry.sequence,
        sourceAgentName: entry.sourceAgentName,
        targetAgentName: entry.targetAgentName,
        messageType: entry.messageType,
        summary: entry.summary,
        confidence: entry.confidence,
      }));

  return {
    globalRecent: pickRecent(reverseChronological, 12),
    channelRecent: pickRecent(
      reverseChronological.filter(
        (entry) => entry.channelId === input.candidate.channelId,
      ),
      6,
    ),
    involvementRecent: pickRecent(
      reverseChronological.filter(
        (entry) =>
          entry.sourceAgentId === input.candidate.sourceAgentId ||
          entry.targetAgentId === input.candidate.sourceAgentId ||
          entry.sourceAgentId === input.candidate.targetAgentId ||
          entry.targetAgentId === input.candidate.targetAgentId,
      ),
      8,
    ),
  };
}

type VoteProgress = {
  voteId: string | null;
  castOption: string | null;
  status: "OPEN" | "CLOSED" | null;
  outcome: "passed" | "no_consensus" | null;
  winner: string | null;
  explanation: string | null;
  quorumReached: boolean | null;
  thresholdReached: boolean | null;
  tie: boolean | null;
  voterCount: number | null;
  leadingOption: string | null;
};

type VoteFinalization = {
  finalizedCount: number;
  passedCount: number;
  noConsensusCount: number;
};

type ForcedVoteResolution = {
  applied: boolean;
  winner: string | null;
  explanation: string | null;
};

async function progressConsensusVoteForTurn(input: {
  db: PrismaClient;
  runId: string;
  actorAgentId: string;
  actorAuthorityWeight: number;
  messageType: ChannelMessageType;
}): Promise<VoteProgress> {
  const openVote = await input.db.vote.findFirst({
    where: {
      runId: input.runId,
      status: VoteStatus.OPEN,
    },
    orderBy: [{ openedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      options: true,
      ballots: true,
      weights: true,
      quorum: true,
      threshold: true,
    },
  });

  if (!openVote) {
    return {
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
    };
  }

  const options = normalizeVoteOptions(openVote.options);
  const castOption = chooseDeterministicVoteOption(options, input.messageType);
  if (!castOption) {
    return {
      voteId: openVote.id,
      castOption: null,
      status: "OPEN",
      outcome: null,
      winner: null,
      explanation: "No valid vote options available.",
      quorumReached: null,
      thresholdReached: null,
      tie: null,
      voterCount: null,
      leadingOption: null,
    };
  }

  const ballots = asObjectRecord(openVote.ballots);
  const weights = asObjectRecord(openVote.weights);
  ballots[input.actorAgentId] = castOption;
  weights[input.actorAgentId] = Math.max(
    1,
    Math.min(20, Math.round(input.actorAuthorityWeight)),
  );

  const result = resolveVoteResult({
    options,
    ballots,
    weights,
    quorum: openVote.quorum,
    threshold: openVote.threshold,
  });
  const shouldClose = result.outcome === "passed";

  await input.db.vote.update({
    where: { id: openVote.id },
    data: {
      ballots: toInputJsonValue(ballots),
      weights: toInputJsonValue(weights),
      result: toInputJsonValue(result),
      status: shouldClose ? VoteStatus.CLOSED : VoteStatus.OPEN,
      closedAt: shouldClose ? new Date() : null,
    },
  });

  return {
    voteId: openVote.id,
    castOption,
    status: shouldClose ? "CLOSED" : "OPEN",
    outcome: result.outcome,
    winner: result.winner,
    explanation: result.explanation,
    quorumReached: result.quorumReached,
    thresholdReached: result.thresholdReached,
    tie: result.tie,
    voterCount: result.voterCount,
    leadingOption: result.ranking[0]?.option ?? null,
  };
}

async function finalizeOpenVotesForRun(input: {
  db: PrismaClient;
  runId: string;
}): Promise<VoteFinalization> {
  const openVotes = await input.db.vote.findMany({
    where: {
      runId: input.runId,
      status: VoteStatus.OPEN,
    },
    select: {
      id: true,
      options: true,
      ballots: true,
      weights: true,
      quorum: true,
      threshold: true,
    },
  });

  if (openVotes.length === 0) {
    return {
      finalizedCount: 0,
      passedCount: 0,
      noConsensusCount: 0,
    };
  }

  let passedCount = 0;
  let noConsensusCount = 0;

  for (const vote of openVotes) {
    const result = resolveVoteResult({
      options: normalizeVoteOptions(vote.options),
      ballots: asObjectRecord(vote.ballots),
      weights: asObjectRecord(vote.weights),
      quorum: vote.quorum,
      threshold: vote.threshold,
    });
    if (result.outcome === "passed") {
      passedCount += 1;
    } else {
      noConsensusCount += 1;
    }

    await input.db.vote.update({
      where: { id: vote.id },
      data: {
        result: toInputJsonValue({
          ...result,
          finalizedBy: "scheduler-finalization",
        }),
        status: VoteStatus.CLOSED,
        closedAt: new Date(),
      },
    });
  }

  return {
    finalizedCount: openVotes.length,
    passedCount,
    noConsensusCount,
  };
}

async function forceCloseVoteForDeadlock(input: {
  db: PrismaClient;
  voteId: string;
  preferredWinner: string | null;
}): Promise<ForcedVoteResolution> {
  const vote = await input.db.vote.findUnique({
    where: { id: input.voteId },
    select: {
      id: true,
      status: true,
      options: true,
      ballots: true,
      weights: true,
      quorum: true,
      threshold: true,
    },
  });

  if (!vote || vote.status !== VoteStatus.OPEN) {
    return {
      applied: false,
      winner: null,
      explanation: null,
    };
  }

  const options = normalizeVoteOptions(vote.options);
  const baseResult = resolveVoteResult({
    options,
    ballots: asObjectRecord(vote.ballots),
    weights: asObjectRecord(vote.weights),
    quorum: vote.quorum,
    threshold: vote.threshold,
  });
  const winner =
    input.preferredWinner ??
    baseResult.winner ??
    baseResult.ranking[0]?.option ??
    options[0] ??
    null;

  if (!winner) {
    return {
      applied: false,
      winner: null,
      explanation:
        "Mediator force_vote failed because no deterministic option was available.",
    };
  }

  const forcedResult = {
    ...baseResult,
    winner,
    tie: false,
    quorumReached: true,
    thresholdReached: true,
    outcome: "passed" as const,
    explanation:
      `Mediator force_vote resolved deadlock with winner ${winner}. ` +
      `Base tally: ${baseResult.explanation}`,
    forcedByMediator: true,
  };

  await input.db.vote.update({
    where: { id: vote.id },
    data: {
      status: VoteStatus.CLOSED,
      closedAt: new Date(),
      result: toInputJsonValue(forcedResult),
    },
  });

  return {
    applied: true,
    winner,
    explanation: forcedResult.explanation,
  };
}

function buildDeadlockOutput(
  evaluation: DeadlockMediationEvaluation,
): {
  status: DeadlockMediationStatus;
  signals: string[];
  action: MediatorAction | null;
  note: string | null;
} {
  return {
    status: evaluation.status,
    signals: evaluation.signals,
    action: evaluation.action,
    note: evaluation.note,
  };
}

export function resolveSchedulerRuntimeOptions(
  runState: unknown,
  overrides?: Partial<SchedulerRuntimeOptions>,
): SchedulerRuntimeOptions {
  const baseState = asObjectRecord(runState);
  const stateRuntime = asObjectRecord(baseState.schedulerRuntime);
  const mergeSource = { ...stateRuntime, ...(overrides ?? {}) };

  return {
    maxRetries: clampInt(
      mergeSource.maxRetries,
      0,
      5,
      DEFAULT_SCHEDULER_RUNTIME_OPTIONS.maxRetries,
    ),
    turnTimeoutMs: clampInt(
      mergeSource.turnTimeoutMs,
      500,
      60_000,
      DEFAULT_SCHEDULER_RUNTIME_OPTIONS.turnTimeoutMs,
    ),
    transientFailureSequences: normalizeSequenceList(
      mergeSource.transientFailureSequences,
    ),
    timeoutFailureSequences: normalizeSequenceList(
      mergeSource.timeoutFailureSequences,
    ),
  };
}

export function pickTurnMessageType(
  allowedMessageTypes: ChannelMessageType[],
  isLastQueuedTurn: boolean,
): ChannelMessageType {
  const allowed: ChannelMessageType[] = allowedMessageTypes.length > 0
    ? allowedMessageTypes
    : ["proposal"];

  if (isLastQueuedTurn && allowed.includes("decision")) {
    return "decision";
  }

  for (const preferred of ["proposal", "critique", "vote_call"] as const) {
    if (allowed.includes(preferred)) {
      return preferred;
    }
  }

  if (allowed.includes("decision")) {
    return "decision";
  }

  return allowed[0] ?? "proposal";
}

export function isRetryableSchedulerError(error: unknown): boolean {
  if (error instanceof SchedulerTurnError) {
    return error.retryable;
  }

  if (error && typeof error === "object") {
    const retryable = (error as { retryable?: unknown }).retryable;
    return retryable === true;
  }

  return false;
}

export async function executeDeterministicTurnAttempt(input: {
  runId: string;
  runObjective: string;
  sequence: number;
  attempt: number;
  candidate: CompiledTurnCandidate;
  conversationContext: GeminiPromptContextWindow;
  role: "executive" | "director" | "manager" | "specialist" | "operator";
  thinkingProfile: "fast" | "standard" | "deep";
  isLastQueuedTurn: boolean;
  runtimeOptions: SchedulerRuntimeOptions;
}): Promise<SimulatedTurnOutput> {
  const {
    runId,
    runObjective,
    sequence,
    attempt,
    candidate,
    conversationContext,
    role,
    thinkingProfile,
    isLastQueuedTurn,
    runtimeOptions,
  } = input;

  if (
    runtimeOptions.transientFailureSequences.includes(sequence) &&
    attempt === 1
  ) {
    throw new SchedulerTurnError(
      "TRANSIENT_RUNTIME",
      `Transient runtime fault on turn ${sequence}.`,
      true,
    );
  }

  const shouldTimeout =
    runtimeOptions.timeoutFailureSequences.includes(sequence) && attempt === 1;
  const modelSelection = selectGeminiModel({
    role,
    thinkingProfile,
  });

  const buildTimeoutFallback = (): SimulatedTurnOutput => {
    const timeoutMessage = `Turn ${sequence} exceeded timeout budget of ${runtimeOptions.turnTimeoutMs}ms.`;
    const structured = buildFallbackAgentActOutput({
      messageType: pickTurnMessageType(
        candidate.allowedMessageTypes,
        isLastQueuedTurn,
      ),
      summary: `${candidate.sourceAgentName} responded to ${candidate.targetAgentName}. (timeout fallback)`,
      rationale: `${timeoutMessage} Returned fallback output to keep run progression stable.`,
      confidence: 0.25,
    });

    return {
      engine: "gemini",
      messageType: structured.messageType,
      summary: structured.summary,
      rationale: structured.rationale,
      confidence: structured.confidence,
      candidateId: candidate.id,
      channelId: candidate.channelId,
      sourceAgentId: candidate.sourceAgentId,
      targetAgentId: candidate.targetAgentId,
      mountItemCount: candidate.mountItemCount,
      prompt: "",
      model: modelSelection.model,
      routeReason: `${modelSelection.routeReason}->timeout-fallback`,
      thinkingLevel: modelSelection.thinkingLevel,
      latencyMs: runtimeOptions.turnTimeoutMs,
      tokens: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
      schema: structured.schema,
      payload: structured.payload,
      validationStatus: "fallback",
      validationIssues: [
        {
          path: "$",
          code: "TURN_TIMEOUT",
          message: timeoutMessage,
        },
      ],
      repairSteps: ["timeout-fallback-output"],
      normalizedOutput: {
        messageType: structured.messageType,
        summary: structured.summary,
        rationale: structured.rationale,
        confidence: structured.confidence,
      },
      requestLog: {
        prompt: "",
        model: modelSelection.model,
        routeReason: `${modelSelection.routeReason}->timeout-fallback`,
      },
      responseLog: {
        rawResponseText: "",
        source: "fallback",
        statusCode: null,
      },
      artifacts: [],
      processedAt: new Date().toISOString(),
    };
  };
  const executionPromise = new Promise<SimulatedTurnOutput>((resolve, reject) => {
    if (shouldTimeout) {
      setTimeout(() => {
        reject(
          new SchedulerTurnError(
            "TURN_TIMEOUT",
            `Turn ${sequence} exceeded timeout budget of ${runtimeOptions.turnTimeoutMs}ms.`,
            true,
          ),
        );
      }, runtimeOptions.turnTimeoutMs + 50);

      return;
    }

    void executeGeminiTurn({
      runId,
      sequence,
      runObjective,
      candidate: {
        id: candidate.id,
        sourceAgentName: candidate.sourceAgentName,
        sourceAgentObjective: candidate.sourceAgentObjective,
        sourceAgentTools: candidate.sourceAgentTools,
        targetAgentName: candidate.targetAgentName,
        targetAgentObjective: candidate.targetAgentObjective,
        stepOrder: candidate.stepOrder,
        allowedMessageTypes: candidate.allowedMessageTypes,
        mountItemCount: candidate.mountItemCount,
      },
      context: conversationContext,
      role,
      thinkingProfile,
      isLastQueuedTurn,
    })
      .then((result) => {
        // Persist only validated/repaired structured output.
        resolve({
          engine: "gemini",
          messageType: result.structured.messageType,
          summary: result.structured.summary,
          rationale: result.structured.rationale,
          confidence: result.structured.confidence,
          candidateId: candidate.id,
          channelId: candidate.channelId,
          sourceAgentId: candidate.sourceAgentId,
          targetAgentId: candidate.targetAgentId,
          mountItemCount: candidate.mountItemCount,
          prompt: result.prompt,
          model: result.telemetry.model,
          routeReason: result.telemetry.routeReason,
          thinkingLevel: result.telemetry.thinkingLevel,
          latencyMs: result.telemetry.latencyMs,
          tokens: result.telemetry.tokenUsage,
          schema: result.structured.schema,
          payload: result.structured.payload,
          validationStatus: result.validation.status,
          validationIssues: result.validation.issues,
          repairSteps: result.validation.repairSteps,
          normalizedOutput: result.normalized,
          requestLog: {
            prompt: result.prompt,
            model: result.telemetry.model,
            routeReason: result.telemetry.routeReason,
          },
          responseLog: {
            rawResponseText: result.rawResponseText.slice(0, 1200),
            source: result.telemetry.source,
            statusCode: result.telemetry.statusCode,
          },
          artifacts: [],
          processedAt: new Date().toISOString(),
        });
      })
      .catch((error) => {
        reject(error);
      });
  });

  const timeoutPromise = new Promise<SimulatedTurnOutput>((_, reject) => {
    setTimeout(() => {
      reject(
        new SchedulerTurnError(
          "TURN_TIMEOUT",
          `Turn ${sequence} exceeded timeout budget of ${runtimeOptions.turnTimeoutMs}ms.`,
          true,
        ),
      );
    }, runtimeOptions.turnTimeoutMs);
  });

  let result: SimulatedTurnOutput;
  try {
    result = await Promise.race([executionPromise, timeoutPromise]);
  } catch (error) {
    if (
      error instanceof SchedulerTurnError &&
      error.code === "TURN_TIMEOUT" &&
      !shouldTimeout
    ) {
      return buildTimeoutFallback();
    }

    throw error;
  }

  return result;
}

function resolveCandidateForTurn(
  turn: TurnRecord,
  candidateById: Map<string, CompiledTurnCandidate>,
  candidateByKey: Map<string, CompiledTurnCandidate>,
): CompiledTurnCandidate | null {
  const candidateId = parseCandidateIdFromInput(turn.input);
  if (candidateId) {
    return candidateById.get(candidateId) ?? null;
  }

  if (!turn.actorAgentId || !turn.channelId) {
    return null;
  }

  return candidateByKey.get(`${turn.channelId}:${turn.actorAgentId}`) ?? null;
}

function buildCheckpoint(
  params: Omit<SchedulerCheckpoint, "updatedAt">,
): SchedulerCheckpoint {
  return {
    ...params,
    updatedAt: new Date().toISOString(),
  };
}

function buildTurnInput(
  turnInput: Prisma.JsonValue | null,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const current = asObjectRecord(turnInput);
  return toInputJsonValue({
    ...current,
    ...patch,
  });
}

function buildRunState(
  runState: Prisma.JsonValue | null,
  runtimeOptions: SchedulerRuntimeOptions,
  checkpoint: SchedulerCheckpoint,
  plan: CompiledRunPlan,
  extras?: Record<string, unknown>,
): Prisma.InputJsonValue {
  const current = asObjectRecord(runState);
  return toInputJsonValue({
    ...current,
    schedulerRuntime: runtimeOptions,
    schedulerCheckpoint: checkpoint,
    compilerSummary: {
      generatedAt: plan.generatedAt,
      valid: plan.valid,
      issueCount: plan.issues.length,
      turnCandidateCount: plan.turnCandidates.length,
    },
    ...(extras ?? {}),
  });
}

function resolveRunObjective(runState: Prisma.JsonValue | null): string {
  const current = asObjectRecord(runState);
  const runObjective =
    typeof current.runObjective === "string"
      ? current.runObjective.trim().slice(0, 400)
      : "";
  if (runObjective.length > 0) {
    return runObjective;
  }

  const template = asObjectRecord(current.template);
  const templateObjective =
    typeof template.objective === "string"
      ? template.objective.trim().slice(0, 400)
      : "";
  if (templateObjective.length > 0) {
    return templateObjective;
  }

  return DEFAULT_BOARD_OBJECTIVE;
}

async function ensureQueuedTurns(
  db: PrismaClient,
  runId: string,
  plan: CompiledRunPlan,
) {
  const existingTurnCount = await db.turn.count({
    where: { runId },
  });

  if (existingTurnCount > 0) {
    return;
  }

  for (const [index, candidate] of plan.turnCandidates.entries()) {
    await db.turn.create({
      data: {
        runId,
        sequence: index + 1,
        actorAgentId: candidate.sourceAgentId,
        channelId: candidate.channelId,
        status: TurnStatus.QUEUED,
        input: toInputJsonValue({
          candidateId: candidate.id,
          priority: candidate.priority,
          allowedMessageTypes: candidate.allowedMessageTypes,
          mountItemIds: candidate.mountItemIds,
          mountItemCount: candidate.mountItemCount,
          attempt: 0,
        }),
      },
    });
  }
}

export async function executeRunScheduler(
  input: ExecuteRunSchedulerInput,
): Promise<RunSchedulerResult> {
  const { db, workspaceId, runId, plan, runtimeOptions } = input;
  if (!plan.valid) {
    throw new Error("Run scheduler received invalid compiler plan.");
  }

  const run = (await db.run.findFirst({
    where: { id: runId, workspaceId },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      status: true,
      startedAt: true,
      state: true,
    },
  })) as RunRecord | null;

  if (!run) {
    throw new Error("Run not found.");
  }
  const runObjective = resolveRunObjective(run.state);

  await ensureQueuedTurns(db, run.id, plan);

  const candidateById = new Map(plan.turnCandidates.map((candidate) => [candidate.id, candidate]));
  const candidateByChannelActor = new Map(
    plan.turnCandidates.map((candidate) => [
      `${candidate.channelId}:${candidate.sourceAgentId}`,
      candidate,
    ]),
  );
  const agentProfileById = new Map(
    plan.graph.agents.map((agent) => [
      agent.agentId,
      {
        name: agent.name,
        role: agent.role,
        thinkingProfile: agent.thinkingProfile,
        authorityWeight: agent.authorityWeight,
      },
    ]),
  );
  const governanceActorProfilesById = new Map<string, GovernanceActorProfile>(
    Array.from(agentProfileById.entries()).map(([agentId, profile]) => [
      agentId,
      {
        agentId,
        role: profile.role,
        authorityWeight: profile.authorityWeight,
      },
    ]),
  );
  const candidateAgentIds = Array.from(
    new Set(plan.turnCandidates.map((candidate) => candidate.sourceAgentId)),
  );
  const candidateChannelIds = Array.from(
    new Set(plan.turnCandidates.map((candidate) => candidate.channelId)),
  );
  const runtimeChannelRows = await db.channel.findMany({
    where: {
      workspaceId,
      id: { in: candidateChannelIds },
    },
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
      updatedAt: true,
    },
  });
  const channelPolicyById = new Map(
    runtimeChannelRows.map((channel) => {
      const config = toCompilerChannelConfig(channel);
      return [
        config.id,
        {
          sourceAgentId: config.sourceAgentId,
          targetAgentId: config.targetAgentId,
          visibility: config.visibility,
          allowedMessageTypes: config.allowedMessageTypes,
          writerAgentIds: config.writerAgentIds,
          readerAgentIds: config.readerAgentIds,
        },
      ] as const;
    }),
  );
  const mountFilters: Prisma.MountWhereInput[] = [{ runId: run.id }];
  if (candidateAgentIds.length > 0) {
    mountFilters.push({ agentId: { in: candidateAgentIds } });
  }
  if (candidateChannelIds.length > 0) {
    mountFilters.push({ channelId: { in: candidateChannelIds } });
  }

  const runtimeMountRows = await db.mount.findMany({
    where: {
      workspaceId,
      OR: mountFilters,
    },
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
  });
  const mountContextByCandidateId = new Map(
    plan.turnCandidates.map((candidate) => [
      candidate.id,
      resolveMountContextFromMounts(runtimeMountRows, {
        runId: run.id,
        agentId: candidate.sourceAgentId,
        channelId: candidate.channelId,
      }),
    ]),
  );
  const governancePolicyScopes: Prisma.PolicyWhereInput[] = [
    { scope: "WORKSPACE" },
    { scope: "RUN", runId: run.id },
  ];
  if (candidateChannelIds.length > 0) {
    governancePolicyScopes.push({
      scope: "CHANNEL",
      channelId: { in: candidateChannelIds },
    });
  }

  const governancePolicyRows = await db.policy.findMany({
    where: {
      workspaceId,
      isActive: true,
      OR: governancePolicyScopes,
    },
    select: {
      id: true,
      name: true,
      kind: true,
      scope: true,
      channelId: true,
      runId: true,
      config: true,
    },
  });
  const governancePolicies = normalizeGovernancePolicies(
    governancePolicyRows.map((policy) => ({
      id: policy.id,
      name: policy.name,
      kind: policy.kind,
      scope: policy.scope,
      channelId: policy.channelId,
      runId: policy.runId,
      config: policy.config,
    })),
  );
  const existingCompletedTurns = await db.turn.findMany({
    where: {
      runId: run.id,
      status: TurnStatus.COMPLETED,
    },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      actorAgentId: true,
      channelId: true,
      output: true,
    },
  });
  const governanceHistory: GovernanceTurnRecord[] = existingCompletedTurns
    .map((turn) => {
      if (!turn.actorAgentId || !turn.channelId) {
        return null;
      }

      const messageType = parseOutputMessageType(turn.output);
      if (!messageType) {
        return null;
      }

      return {
        turnId: turn.id,
        sequence: turn.sequence,
        actorAgentId: turn.actorAgentId,
        channelId: turn.channelId,
        messageType,
      };
    })
    .filter((entry): entry is GovernanceTurnRecord => entry !== null);
  const conversationHistory: ConversationHistoryEntry[] = existingCompletedTurns
    .map((turn) => {
      if (!turn.actorAgentId || !turn.channelId) {
        return null;
      }

      const candidate = candidateByChannelActor.get(
        `${turn.channelId}:${turn.actorAgentId}`,
      );
      if (!candidate) {
        return null;
      }

      const messageType = parseOutputMessageType(turn.output);
      if (!messageType) {
        return null;
      }

      const summary =
        parseOutputSummary(turn.output) ??
        `${candidate.sourceAgentName} updated ${candidate.targetAgentName}.`;

      return {
        sequence: turn.sequence,
        channelId: turn.channelId,
        sourceAgentId: candidate.sourceAgentId,
        sourceAgentName: candidate.sourceAgentName,
        targetAgentId: candidate.targetAgentId,
        targetAgentName: candidate.targetAgentName,
        messageType,
        summary,
        confidence: parseOutputConfidence(turn.output),
      };
    })
    .filter((entry): entry is ConversationHistoryEntry => entry !== null)
    .sort((a, b) => a.sequence - b.sequence);

  let processedAttempts = 0;
  let completedTurns = 0;
  let blockedTurns = 0;
  let skippedTurns = 0;
  let retriesUsed = 0;
  let decisionReached = false;
  let deadlockResolved = false;
  let deadlockTerminated = false;
  let deadlockSummary: {
    status: DeadlockMediationStatus;
    action: MediatorAction | null;
    note: string | null;
    signals: string[];
  } = {
    status: "none",
    action: null,
    note: null,
    signals: [],
  };
  let lastCheckpoint = buildCheckpoint({
    lastTurnId: null,
    lastSequence: 0,
    queueDepth: plan.turnCandidates.length,
    completedTurns: 0,
    blockedTurns: 0,
    skippedTurns: 0,
    retriesUsed: 0,
    processedAttempts: 0,
    note: "Scheduler initialized.",
  });

  await db.run.update({
    where: { id: run.id },
    data: {
      status: RunStatus.QUEUED,
      startedAt: run.startedAt ?? new Date(),
      endedAt: null,
      boardSnapshot: toInputJsonValue({
        agentIds: plan.graph.agents.map((agent) => agent.agentId),
        channelIds: plan.graph.channels.map((channel) => channel.channelId),
      }),
      state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan, {
        finalDraft: null,
        finalDraftTelemetry: null,
      }),
    },
  });

  let loopGuard = 0;
  while (loopGuard < 500) {
    loopGuard += 1;

    const turn = (await db.turn.findFirst({
      where: { runId: run.id, status: TurnStatus.QUEUED },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        status: true,
        actorAgentId: true,
        channelId: true,
        input: true,
      },
    })) as TurnRecord | null;

    if (!turn) {
      break;
    }

    const existingAttempt = parseAttemptCount(turn.input);
    const attempt = existingAttempt + 1;
    const queuedCount = await db.turn.count({
      where: {
        runId: run.id,
        status: TurnStatus.QUEUED,
      },
    });

    await db.turn.update({
      where: { id: turn.id },
      data: {
        status: TurnStatus.RUNNING,
        startedAt: new Date(),
        error: null,
        input: buildTurnInput(turn.input, { attempt }),
      },
    });

    await db.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.RUNNING,
      },
    });

    processedAttempts += 1;

    const candidate = resolveCandidateForTurn(
      turn,
      candidateById,
      candidateByChannelActor,
    );
    if (!candidate) {
      blockedTurns += 1;
      lastCheckpoint = buildCheckpoint({
        lastTurnId: turn.id,
        lastSequence: turn.sequence,
        queueDepth: Math.max(queuedCount - 1, 0),
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        processedAttempts,
        note: "Turn blocked because candidate mapping is missing.",
      });

      await db.turn.update({
        where: { id: turn.id },
        data: {
          status: TurnStatus.BLOCKED,
          endedAt: new Date(),
          error: "[CANDIDATE_NOT_FOUND] Could not map queued turn to compiler candidate.",
          input: buildTurnInput(turn.input, {
            attempt,
            errorCode: "CANDIDATE_NOT_FOUND",
          }),
        },
      });

      await db.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.BLOCKED,
          endedAt: new Date(),
          state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
        },
      });

      return {
        runId: run.id,
        status: "blocked",
        processedAttempts,
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        decisionReached,
        checkpoint: lastCheckpoint,
        deadlock: deadlockSummary,
      };
    }

    const channelPolicy = channelPolicyById.get(candidate.channelId);
    if (!channelPolicy) {
      blockedTurns += 1;
      lastCheckpoint = buildCheckpoint({
        lastTurnId: turn.id,
        lastSequence: turn.sequence,
        queueDepth: Math.max(queuedCount - 1, 0),
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        processedAttempts,
        note: "Turn blocked because channel policy is missing.",
      });

      await db.turn.update({
        where: { id: turn.id },
        data: {
          status: TurnStatus.BLOCKED,
          endedAt: new Date(),
          error: "[CHANNEL_POLICY_MISSING] Could not resolve channel ACL policy for turn candidate.",
          input: buildTurnInput(turn.input, {
            attempt,
            errorCode: "CHANNEL_POLICY_MISSING",
          }),
        },
      });

      await db.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.BLOCKED,
          endedAt: new Date(),
          state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
        },
      });

      return {
        runId: run.id,
        status: "blocked",
        processedAttempts,
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        decisionReached,
        checkpoint: lastCheckpoint,
        deadlock: deadlockSummary,
      };
    }

    const mountContext = mountContextByCandidateId.get(candidate.id) ?? {
      runId: run.id,
      agentId: candidate.sourceAgentId,
      channelId: candidate.channelId,
      items: [],
    };

    try {
      const actorProfile = agentProfileById.get(candidate.sourceAgentId) ?? {
        name: "Unknown",
        role: "manager" as const,
        thinkingProfile: "standard" as const,
        authorityWeight: 1,
      };

      const output = await executeDeterministicTurnAttempt({
        runId: run.id,
        runObjective,
        sequence: turn.sequence,
        attempt,
        candidate,
        conversationContext: buildConversationContextWindow({
          history: conversationHistory,
          candidate,
        }),
        role: actorProfile.role,
        thinkingProfile: actorProfile.thinkingProfile,
        isLastQueuedTurn: queuedCount <= 1,
        runtimeOptions,
      });
      const governance = evaluateGovernanceForTurn({
        policies: governancePolicies,
        history: governanceHistory,
        current: {
          turnId: turn.id,
          sequence: turn.sequence,
          actorAgentId: candidate.sourceAgentId,
          channelId: candidate.channelId,
          messageType: output.messageType,
        },
        actorProfilesById: governanceActorProfilesById,
        blockedTurns,
      });
      if (governance.status === "blocked") {
        blockedTurns += 1;
        const governanceReasons = governance.reasons
          .slice(0, 3)
          .join(" | ")
          .slice(0, 360);
        const escalationNote = governance.escalation.note
          ? ` ${governance.escalation.note}`
          : "";
        lastCheckpoint = buildCheckpoint({
          lastTurnId: turn.id,
          lastSequence: turn.sequence,
          queueDepth: Math.max(queuedCount - 1, 0),
          completedTurns,
          blockedTurns,
          skippedTurns,
          retriesUsed,
          processedAttempts,
          note: `Turn ${turn.sequence} blocked by governance policy.${escalationNote}`,
        });
        const blockedOutput: SimulatedTurnOutput = {
          ...output,
          governance,
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
          toolCalls: [],
          toolSummary: {
            requested: 0,
            executed: 0,
            blocked: 0,
            invalid: 0,
          },
          toolEffects: {
            voteIds: [],
            checkpointLabels: [],
            requestedRunStatus: null,
          },
        };

        await db.turn.update({
          where: { id: turn.id },
          data: {
            status: TurnStatus.BLOCKED,
            endedAt: new Date(),
            error: `[GOVERNANCE_BLOCKED] ${governanceReasons || "Decision does not meet approval/veto policy."}`,
            input: buildTurnInput(turn.input, {
              attempt,
              errorCode: "GOVERNANCE_BLOCKED",
            }),
            output: toInputJsonValue(blockedOutput),
          },
        });

        await db.run.update({
          where: { id: run.id },
          data: {
            status: RunStatus.BLOCKED,
            endedAt: new Date(),
            state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
          },
        });

        return {
          runId: run.id,
          status: "blocked",
          processedAttempts,
          completedTurns,
          blockedTurns,
          skippedTurns,
          retriesUsed,
          decisionReached,
          checkpoint: lastCheckpoint,
          deadlock: deadlockSummary,
        };
      }
      const generatedArtifacts: NonNullable<SimulatedTurnOutput["artifacts"]> = [];
      if (candidate.sourceAgentTools.imageGenerationEnabled) {
        try {
          const imageArtifact = await generateGeminiImageArtifact({
            runId: run.id,
            sequence: turn.sequence,
            runObjective,
            sourceAgentName: candidate.sourceAgentName,
            sourceAgentObjective: candidate.sourceAgentObjective,
            messageSummary: output.summary,
            messageRationale: output.rationale,
          });

          if (imageArtifact) {
            const mimeType = imageArtifact.mimeType.toLowerCase();
            if (mimeType.startsWith("image/")) {
              const extension = extensionForMimeType(mimeType);
              const safeAgentName =
                candidate.sourceAgentName
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
                  .slice(0, 24) || "agent";
              const fileName = `run-${run.id.slice(-8)}-t${turn.sequence}-${safeAgentName}${extension}`;
              const storageKey = createVaultStorageKey(workspaceId, fileName);

              await writeVaultBuffer(storageKey, imageArtifact.bytes);
              try {
                const savedArtifact = await db.vaultItem.create({
                  data: {
                    workspaceId,
                    name: `${candidate.sourceAgentName} T${turn.sequence} image`.slice(
                      0,
                      80,
                    ),
                    fileName,
                    mimeType,
                    byteSize: imageArtifact.bytes.byteLength,
                    storageKey,
                    tags: ["assets"],
                    metadata: {
                      generatedBy: "agent_image_output",
                      runId: run.id,
                      turnId: turn.id,
                      sequence: turn.sequence,
                      sourceAgentId: candidate.sourceAgentId,
                      model: imageArtifact.model,
                    },
                  },
                  select: {
                    id: true,
                    name: true,
                    fileName: true,
                    mimeType: true,
                    byteSize: true,
                  },
                });

                generatedArtifacts.push({
                  kind: "image",
                  vaultItemId: savedArtifact.id,
                  name: savedArtifact.name,
                  fileName: savedArtifact.fileName,
                  mimeType: savedArtifact.mimeType,
                  byteSize: savedArtifact.byteSize,
                  model: imageArtifact.model,
                });
              } catch (error) {
                await deleteVaultBuffer(storageKey);
                throw error;
              }
            }
          }
        } catch {
          // Keep scheduler turns resilient: artifact generation should not block core execution.
        }
      }

      const toolCalls = buildDefaultToolCallsForTurn({
        channelId: candidate.channelId,
        sequence: turn.sequence,
        messageType: output.messageType,
        summary: output.summary,
        confidence: output.confidence,
        payload: output.payload,
        mountItemIds: candidate.mountItemIds,
      });
      const toolGateway = await executeToolGatewayBatch({
        db,
        workspaceId,
        runId: run.id,
        turnId: turn.id,
        sequence: turn.sequence,
        actorAgentId: candidate.sourceAgentId,
        actorRole: actorProfile.role,
        channelId: candidate.channelId,
        channelPolicy,
        mountedItems: mountContext.items,
        toolCalls,
      });
      const consensusProgress = await progressConsensusVoteForTurn({
        db,
        runId: run.id,
        actorAgentId: candidate.sourceAgentId,
        actorAuthorityWeight: actorProfile.authorityWeight,
        messageType: output.messageType,
      });
      const deadlockHistory: DeadlockHistoryTurn[] = governanceHistory.map(
        (entry) => ({
          sequence: entry.sequence,
          messageType: entry.messageType,
        }),
      );
      let deadlockEvaluation = evaluateDeadlockMediation({
        history: deadlockHistory,
        currentMessageType: output.messageType,
        queuedTurnsRemaining: Math.max(queuedCount - 1, 0),
        failureCode: null,
        retriesExhausted: false,
        vote: {
          voteId: consensusProgress.voteId,
          status: consensusProgress.status,
          outcome: consensusProgress.outcome,
          winner: consensusProgress.winner,
          quorumReached: consensusProgress.quorumReached,
          thresholdReached: consensusProgress.thresholdReached,
          tie: consensusProgress.tie,
        },
      });
      let effectiveConsensusProgress = consensusProgress;

      if (deadlockEvaluation.forceVote && consensusProgress.voteId) {
        const forcedVote = await forceCloseVoteForDeadlock({
          db,
          voteId: consensusProgress.voteId,
          preferredWinner:
            consensusProgress.winner ??
            consensusProgress.leadingOption ??
            consensusProgress.castOption,
        });
        if (forcedVote.applied) {
          effectiveConsensusProgress = {
            ...consensusProgress,
            status: "CLOSED",
            outcome: "passed",
            winner: forcedVote.winner,
            explanation: forcedVote.explanation,
          };
          deadlockEvaluation = {
            ...deadlockEvaluation,
            status: "resolved",
            note:
              forcedVote.explanation ??
              "Mediator force_vote resolved deadlock.",
            resolveRun: true,
            terminateRun: false,
            forceVote: false,
          };
        } else {
          deadlockEvaluation = {
            ...deadlockEvaluation,
            status: "terminated",
            action: "summarize",
            note:
              forcedVote.explanation ??
              "Mediator could not force a deterministic vote winner; terminating run.",
            terminateRun: true,
            resolveRun: false,
            forceVote: false,
          };
        }
      }

      if (deadlockEvaluation.deadlocked) {
        deadlockSummary = buildDeadlockOutput(deadlockEvaluation);
      }

      const persistedOutput: SimulatedTurnOutput = {
        ...output,
        artifacts: generatedArtifacts,
        governance,
        consensus: {
          ...effectiveConsensusProgress,
          finalizedOpenVotes: 0,
        },
        deadlock: buildDeadlockOutput(deadlockEvaluation),
        toolCalls: toolGateway.events,
        toolSummary: toolGateway.summary,
        toolEffects: {
          voteIds: toolGateway.voteIds,
          checkpointLabels: toolGateway.checkpointLabels,
          requestedRunStatus: toolGateway.requestedRunStatus,
        },
      };
      const latestToolCheckpoint =
        toolGateway.checkpointLabels.length > 0
          ? toolGateway.checkpointLabels[toolGateway.checkpointLabels.length - 1]
          : null;
      const blockedToolCount =
        toolGateway.summary.blocked + toolGateway.summary.invalid;
      const toolCheckpointNote = latestToolCheckpoint
        ? ` Tool checkpoint: ${latestToolCheckpoint}.`
        : "";
      const toolBlockedNote =
        blockedToolCount > 0
          ? ` Tool gateway blocked ${blockedToolCount} call(s).`
          : "";
      const requestedStatusNote = toolGateway.requestedRunStatus
        ? ` Requested status: ${toolGateway.requestedRunStatus}.`
        : "";
      const escalationNote = governance.escalation.note
        ? ` Escalation: ${governance.escalation.note}.`
        : "";
      const consensusNote = effectiveConsensusProgress.voteId
        ? ` Vote ${effectiveConsensusProgress.status?.toLowerCase()}: ${effectiveConsensusProgress.outcome ?? "pending"}${
            effectiveConsensusProgress.winner ? ` (${effectiveConsensusProgress.winner})` : ""
          }.`
        : "";
      const deadlockNote = deadlockEvaluation.deadlocked
        ? ` Mediation: ${deadlockEvaluation.note}.`
        : "";

      if (deadlockEvaluation.terminateRun) {
        blockedTurns += 1;
        deadlockTerminated = true;
        lastCheckpoint = buildCheckpoint({
          lastTurnId: turn.id,
          lastSequence: turn.sequence,
          queueDepth: Math.max(queuedCount - 1, 0),
          completedTurns,
          blockedTurns,
          skippedTurns,
          retriesUsed,
          processedAttempts,
          note: `Turn ${turn.sequence} terminated by mediator.${deadlockNote}`,
        });

        await db.turn.update({
          where: { id: turn.id },
          data: {
            status: TurnStatus.BLOCKED,
            endedAt: new Date(),
            error: `[DEADLOCK_TERMINATED] ${deadlockEvaluation.note}`,
            input: buildTurnInput(turn.input, {
              attempt,
              errorCode: "DEADLOCK_TERMINATED",
            }),
            output: toInputJsonValue(persistedOutput),
          },
        });

        await db.run.update({
          where: { id: run.id },
          data: {
            status: RunStatus.BLOCKED,
            endedAt: new Date(),
            state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
          },
        });

        return {
          runId: run.id,
          status: "blocked",
          processedAttempts,
          completedTurns,
          blockedTurns,
          skippedTurns,
          retriesUsed,
          decisionReached,
          checkpoint: lastCheckpoint,
          deadlock: deadlockSummary,
        };
      }

      completedTurns += 1;
      decisionReached = output.messageType === "decision";
      deadlockResolved = deadlockResolved || deadlockEvaluation.resolveRun;
      lastCheckpoint = buildCheckpoint({
        lastTurnId: turn.id,
        lastSequence: turn.sequence,
        queueDepth: Math.max(queuedCount - 1, 0),
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        processedAttempts,
        note: decisionReached || deadlockResolved
          ? decisionReached
            ? `Decision message reached; scheduler will close remaining queued turns.${toolCheckpointNote}${toolBlockedNote}${requestedStatusNote}${escalationNote}${consensusNote}${deadlockNote}`
            : `Deadlock resolved by mediator; scheduler will close remaining queued turns.${toolCheckpointNote}${toolBlockedNote}${requestedStatusNote}${escalationNote}${consensusNote}${deadlockNote}`
          : `Turn ${turn.sequence} completed.${toolCheckpointNote}${toolBlockedNote}${requestedStatusNote}${escalationNote}${consensusNote}${deadlockNote}`,
      });

      await db.turn.update({
        where: { id: turn.id },
        data: {
          status: TurnStatus.COMPLETED,
          endedAt: new Date(),
          input: buildTurnInput(turn.input, {
            attempt,
            lastMessageType: output.messageType,
          }),
          output: toInputJsonValue(persistedOutput),
        },
      });

      await db.run.update({
        where: { id: run.id },
        data: {
          state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
        },
      });
      governanceHistory.push({
        turnId: turn.id,
        sequence: turn.sequence,
        actorAgentId: candidate.sourceAgentId,
        channelId: candidate.channelId,
        messageType: output.messageType,
      });
      conversationHistory.push({
        sequence: turn.sequence,
        channelId: candidate.channelId,
        sourceAgentId: candidate.sourceAgentId,
        sourceAgentName: candidate.sourceAgentName,
        targetAgentId: candidate.targetAgentId,
        targetAgentName: candidate.targetAgentName,
        messageType: output.messageType,
        summary: output.summary.slice(0, 260),
        confidence: output.confidence,
      });

      if (decisionReached || deadlockResolved) {
        break;
      }
    } catch (error) {
      const isRetryable = isRetryableSchedulerError(error);
      const failureMessage =
        error instanceof Error ? error.message : "Unknown turn execution failure.";
      const failureCode =
        error instanceof SchedulerTurnError ? error.code : "TRANSIENT_RUNTIME";

      if (isRetryable && attempt <= runtimeOptions.maxRetries) {
        retriesUsed += 1;
        lastCheckpoint = buildCheckpoint({
          lastTurnId: turn.id,
          lastSequence: turn.sequence,
          queueDepth: queuedCount,
          completedTurns,
          blockedTurns,
          skippedTurns,
          retriesUsed,
          processedAttempts,
          note: `Retry queued for turn ${turn.sequence} (${attempt}/${runtimeOptions.maxRetries}).`,
        });

        await db.turn.update({
          where: { id: turn.id },
          data: {
            status: TurnStatus.QUEUED,
            endedAt: null,
            error: `[${failureCode}] ${failureMessage}`,
            input: buildTurnInput(turn.input, {
              attempt,
              errorCode: failureCode,
            }),
          },
        });

        await db.run.update({
          where: { id: run.id },
          data: {
            state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
          },
        });

        continue;
      }

      const deadlockEvaluation = evaluateDeadlockMediation({
        history: governanceHistory.map((entry) => ({
          sequence: entry.sequence,
          messageType: entry.messageType,
        })),
        currentMessageType: null,
        queuedTurnsRemaining: Math.max(queuedCount - 1, 0),
        failureCode,
        retriesExhausted: true,
        vote: {
          voteId: null,
          status: null,
          outcome: null,
          winner: null,
          quorumReached: null,
          thresholdReached: null,
          tie: null,
        },
      });
      if (deadlockEvaluation.deadlocked) {
        deadlockSummary = buildDeadlockOutput(deadlockEvaluation);
      }
      if (deadlockEvaluation.terminateRun) {
        deadlockTerminated = true;
      }

      blockedTurns += 1;
      lastCheckpoint = buildCheckpoint({
        lastTurnId: turn.id,
        lastSequence: turn.sequence,
        queueDepth: Math.max(queuedCount - 1, 0),
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        processedAttempts,
        note: deadlockEvaluation.deadlocked
          ? `Turn ${turn.sequence} blocked after retries. ${deadlockEvaluation.note}`
          : `Turn ${turn.sequence} blocked after retries.`,
      });

      await db.turn.update({
        where: { id: turn.id },
        data: {
          status: TurnStatus.BLOCKED,
          endedAt: new Date(),
          error: deadlockEvaluation.terminateRun
            ? `[DEADLOCK_TERMINATED] ${deadlockEvaluation.note}`
            : `[${failureCode}] ${failureMessage}`,
          input: buildTurnInput(turn.input, {
            attempt,
            errorCode:
              deadlockEvaluation.terminateRun
                ? "DEADLOCK_TERMINATED"
                : failureCode,
            retriesExhausted: true,
          }),
          output: toInputJsonValue({
            deadlock: buildDeadlockOutput(deadlockEvaluation),
            processedAt: new Date().toISOString(),
          }),
        },
      });

      await db.run.update({
        where: { id: run.id },
        data: {
          status: RunStatus.BLOCKED,
          endedAt: new Date(),
          state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan),
        },
      });

      return {
        runId: run.id,
        status: "blocked",
        processedAttempts,
        completedTurns,
        blockedTurns,
        skippedTurns,
        retriesUsed,
        decisionReached,
        checkpoint: lastCheckpoint,
        deadlock: deadlockSummary,
      };
    }
  }

  if (decisionReached || deadlockResolved) {
    const skipped = await db.turn.updateMany({
      where: {
        runId: run.id,
        status: TurnStatus.QUEUED,
      },
      data: {
        status: TurnStatus.SKIPPED,
        endedAt: new Date(),
        error: decisionReached
          ? "Skipped because a decision message finalized the run."
          : "Skipped because deadlock mediation resolved the run.",
      },
    });
    skippedTurns += skipped.count;
  }
  const voteFinalization = await finalizeOpenVotesForRun({
    db,
    runId: run.id,
  });
  const voteFinalizationNote =
    voteFinalization.finalizedCount > 0
      ? ` Votes finalized ${voteFinalization.finalizedCount} (passed ${voteFinalization.passedCount}, no-consensus ${voteFinalization.noConsensusCount}).`
      : "";

  lastCheckpoint = buildCheckpoint({
    lastTurnId: lastCheckpoint.lastTurnId,
    lastSequence: lastCheckpoint.lastSequence,
    queueDepth: 0,
    completedTurns,
    blockedTurns,
    skippedTurns,
    retriesUsed,
    processedAttempts,
    note: blockedTurns > 0
      ? deadlockTerminated
        ? `Run blocked by deadlock mediation.${voteFinalizationNote}`
        : `Run blocked.${voteFinalizationNote}`
      : decisionReached
        ? `Run completed after decision.${voteFinalizationNote}`
        : deadlockResolved
          ? `Run completed after deadlock mediation.${voteFinalizationNote}`
      : `Run completed after exhausting queued turns.${voteFinalizationNote}`,
  });

  const [settledTurns, latestVote, openVoteCount] = await Promise.all([
    db.turn.findMany({
      where: {
        runId: run.id,
        status: {
          in: [TurnStatus.COMPLETED, TurnStatus.SKIPPED, TurnStatus.BLOCKED],
        },
      },
      orderBy: { sequence: "asc" },
      select: {
        sequence: true,
        status: true,
        startedAt: true,
        endedAt: true,
        output: true,
        actorAgent: {
          select: {
            name: true,
          },
        },
        channel: {
          select: {
            name: true,
          },
        },
      },
      take: 160,
    }),
    db.vote.findFirst({
      where: {
        runId: run.id,
      },
      orderBy: [{ updatedAt: "desc" }, { openedAt: "desc" }],
      select: {
        status: true,
        result: true,
      },
    }),
    db.vote.count({
      where: {
        runId: run.id,
        status: VoteStatus.OPEN,
      },
    }),
  ]);

  const latestVoteResult = parseVoteResult(latestVote?.result ?? null);
  const draftResult = await synthesizeGeminiFinalDraft({
    runName: run.name,
    runObjective,
    runStatus: blockedTurns > 0 ? "BLOCKED" : RunStatus.COMPLETED,
    updatedAt: new Date().toISOString(),
    turns: settledTurns.map((turn) => ({
      sequence: turn.sequence,
      status: turn.status,
      actorName: turn.actorAgent?.name ?? "Unknown actor",
      channelName: turn.channel?.name ?? "Unknown channel",
      messageType: parseOutputMessageType(turn.output),
      summary: parseOutputSummary(turn.output),
      rationale: parseOutputRationale(turn.output),
      payload: parseOutputPayload(turn.output),
      artifacts: parseOutputArtifacts(turn.output),
      endedAt: turn.endedAt ? turn.endedAt.toISOString() : null,
      startedAt: turn.startedAt ? turn.startedAt.toISOString() : null,
    })),
    vote: latestVote
      ? {
          status: latestVote.status,
          outcome: latestVoteResult.outcome,
          winner: latestVoteResult.winner,
          explanation: latestVoteResult.explanation,
          openCount: openVoteCount,
        }
      : null,
    deadlock:
      deadlockSummary.status !== "none"
        ? {
            status: deadlockSummary.status,
            action: deadlockSummary.action,
            note: deadlockSummary.note,
            signals: deadlockSummary.signals,
          }
        : null,
  });

  await db.run.update({
    where: { id: run.id },
    data: {
      status: blockedTurns > 0 ? RunStatus.BLOCKED : RunStatus.COMPLETED,
      endedAt: new Date(),
      state: buildRunState(run.state, runtimeOptions, lastCheckpoint, plan, {
        finalDraft: draftResult.draft,
        finalDraftTelemetry: {
          source: draftResult.telemetry.source,
          model: draftResult.telemetry.model,
          routeReason: draftResult.telemetry.routeReason,
          thinkingLevel: draftResult.telemetry.thinkingLevel,
          latencyMs: draftResult.telemetry.latencyMs,
          statusCode: draftResult.telemetry.statusCode,
          tokenUsage: draftResult.telemetry.tokenUsage,
          generatedAt: new Date().toISOString(),
        },
      }),
    },
  });

  return {
    runId: run.id,
    status: blockedTurns > 0 ? "blocked" : "completed",
    processedAttempts,
    completedTurns,
    blockedTurns,
    skippedTurns,
    retriesUsed,
    decisionReached,
    checkpoint: lastCheckpoint,
    deadlock: deadlockSummary,
  };
}
