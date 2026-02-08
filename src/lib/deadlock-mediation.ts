import type { ChannelMessageType } from "./board-state";

export type DeadlockSignal =
  | "repeated_objections"
  | "timeout_exhaustion"
  | "no_majority";

export type MediatorAction = "summarize" | "request_evidence" | "force_vote";

export type DeadlockMediationStatus =
  | "none"
  | "monitoring"
  | "resolved"
  | "terminated";

export type DeadlockHistoryTurn = {
  sequence: number;
  messageType: ChannelMessageType;
};

export type DeadlockVoteSnapshot = {
  voteId: string | null;
  status: "OPEN" | "CLOSED" | null;
  outcome: "passed" | "no_consensus" | null;
  winner: string | null;
  quorumReached: boolean | null;
  thresholdReached: boolean | null;
  tie: boolean | null;
};

export type EvaluateDeadlockMediationInput = {
  history: DeadlockHistoryTurn[];
  currentMessageType: ChannelMessageType | null;
  queuedTurnsRemaining: number;
  failureCode: string | null;
  retriesExhausted: boolean;
  vote: DeadlockVoteSnapshot;
};

export type DeadlockMediationEvaluation = {
  status: DeadlockMediationStatus;
  deadlocked: boolean;
  signals: DeadlockSignal[];
  action: MediatorAction | null;
  note: string;
  critiqueStreak: number;
  terminateRun: boolean;
  resolveRun: boolean;
  forceVote: boolean;
};

function clampNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function countRecentCritiqueStreak(input: {
  history: DeadlockHistoryTurn[];
  currentMessageType: ChannelMessageType | null;
}): number {
  const messageTypes = input.history
    .map((entry) => entry.messageType)
    .filter((entry): entry is ChannelMessageType => typeof entry === "string");

  if (input.currentMessageType) {
    messageTypes.push(input.currentMessageType);
  }

  let streak = 0;
  for (let index = messageTypes.length - 1; index >= 0; index -= 1) {
    if (messageTypes[index] !== "critique") {
      break;
    }
    streak += 1;
  }

  return streak;
}

function hasNoMajorityDeadlock(input: {
  vote: DeadlockVoteSnapshot;
  queuedTurnsRemaining: number;
}): boolean {
  if (!input.vote.voteId) {
    return false;
  }

  if (input.vote.status !== "OPEN") {
    return false;
  }

  if (input.vote.outcome !== "no_consensus") {
    return false;
  }

  if (input.vote.quorumReached !== true) {
    return false;
  }

  return input.queuedTurnsRemaining <= 0;
}

export function evaluateDeadlockMediation(
  input: EvaluateDeadlockMediationInput,
): DeadlockMediationEvaluation {
  const queuedTurnsRemaining = clampNonNegativeInt(input.queuedTurnsRemaining);
  const critiqueStreak = countRecentCritiqueStreak({
    history: input.history,
    currentMessageType: input.currentMessageType,
  });

  const signals: DeadlockSignal[] = [];
  if (critiqueStreak >= 2) {
    signals.push("repeated_objections");
  }

  if (input.failureCode === "TURN_TIMEOUT" && input.retriesExhausted) {
    signals.push("timeout_exhaustion");
  }

  if (
    hasNoMajorityDeadlock({
      vote: input.vote,
      queuedTurnsRemaining,
    })
  ) {
    signals.push("no_majority");
  }

  const deadlocked = signals.length > 0;

  if (signals.includes("timeout_exhaustion")) {
    return {
      status: "terminated",
      deadlocked,
      signals,
      action: "summarize",
      note:
        "Mediator terminated the run after timeout retries were exhausted.",
      critiqueStreak,
      terminateRun: true,
      resolveRun: false,
      forceVote: false,
    };
  }

  if (signals.includes("no_majority")) {
    return {
      status: "resolved",
      deadlocked,
      signals,
      action: "force_vote",
      note:
        "Mediator detected no majority and will force a deterministic vote outcome.",
      critiqueStreak,
      terminateRun: false,
      resolveRun: true,
      forceVote: true,
    };
  }

  if (signals.includes("repeated_objections")) {
    const action: MediatorAction = critiqueStreak >= 3
      ? "request_evidence"
      : "summarize";

    return {
      status: "monitoring",
      deadlocked,
      signals,
      action,
      note:
        action === "request_evidence"
          ? "Mediator requested additional evidence after repeated objections."
          : "Mediator summarized objections to stabilize discussion.",
      critiqueStreak,
      terminateRun: false,
      resolveRun: false,
      forceVote: false,
    };
  }

  return {
    status: "none",
    deadlocked: false,
    signals: [],
    action: null,
    note: "No deadlock signals detected.",
    critiqueStreak,
    terminateRun: false,
    resolveRun: false,
    forceVote: false,
  };
}
