import type { ChannelMessageType } from "./board-state";

export type VoteOptionScore = {
  option: string;
  weight: number;
  votes: number;
};

export type VoteResult = {
  version: 1;
  winner: string | null;
  ranking: VoteOptionScore[];
  quorum: number;
  threshold: number | null;
  voterCount: number;
  participatingWeight: number;
  quorumReached: boolean;
  thresholdReached: boolean;
  tie: boolean;
  outcome: "passed" | "no_consensus";
  explanation: string;
};

export type ResolveVoteResultInput = {
  options: string[];
  ballots: Record<string, unknown>;
  weights: Record<string, unknown>;
  quorum: number | null;
  threshold: number | null;
};

function normalizeOption(option: unknown): string | null {
  if (typeof option !== "string") {
    return null;
  }

  const trimmed = option.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, 120);
}

export function normalizeVoteOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOption(entry))
    .filter((entry): entry is string => entry !== null)
    .filter((entry, index, collection) => collection.indexOf(entry) === index)
    .slice(0, 12);
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.round(value));
}

function parseBallotEntries(
  ballots: Record<string, unknown>,
  options: string[],
): Array<{ agentId: string; option: string }> {
  const allowedOptions = new Set(options);
  return Object.entries(ballots)
    .map(([agentId, value]) => {
      const normalizedAgentId = normalizeOption(agentId);
      const normalizedOption = normalizeOption(value);
      if (!normalizedAgentId || !normalizedOption) {
        return null;
      }
      if (!allowedOptions.has(normalizedOption)) {
        return null;
      }
      return {
        agentId: normalizedAgentId,
        option: normalizedOption,
      };
    })
    .filter(
      (entry): entry is { agentId: string; option: string } => entry !== null,
    )
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

function weightForAgent(weights: Record<string, unknown>, agentId: string): number {
  const raw = weights[agentId];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 1;
  }

  return Math.max(1, Math.min(20, Math.round(raw)));
}

export function chooseDeterministicVoteOption(
  options: string[],
  messageType: ChannelMessageType,
): string | null {
  if (options.length === 0) {
    return null;
  }

  if (messageType === "critique") {
    return options[1] ?? options[0] ?? null;
  }

  if (messageType === "vote_call") {
    return options[2] ?? options[0] ?? null;
  }

  // proposal + decision default to first option (approval path).
  return options[0] ?? null;
}

export function resolveVoteResult(input: ResolveVoteResultInput): VoteResult {
  const options = normalizeVoteOptions(input.options);
  const safeBallots =
    input.ballots && typeof input.ballots === "object" && !Array.isArray(input.ballots)
      ? input.ballots
      : {};
  const safeWeights =
    input.weights && typeof input.weights === "object" && !Array.isArray(input.weights)
      ? input.weights
      : {};
  const quorum = Math.max(1, toPositiveInt(input.quorum, 1));
  const threshold =
    input.threshold === null || input.threshold === undefined
      ? null
      : Math.max(1, toPositiveInt(input.threshold, 1));

  const ranking = options.map((option) => ({
    option,
    weight: 0,
    votes: 0,
  }));
  const optionIndexByName = new Map(
    ranking.map((entry, index) => [entry.option, index]),
  );

  const ballotEntries = parseBallotEntries(safeBallots, options);
  let participatingWeight = 0;
  for (const ballot of ballotEntries) {
    const index = optionIndexByName.get(ballot.option);
    if (index === undefined) {
      continue;
    }
    const weight = weightForAgent(safeWeights, ballot.agentId);
    ranking[index]!.weight += weight;
    ranking[index]!.votes += 1;
    participatingWeight += weight;
  }

  const sortedRanking = [...ranking].sort((a, b) => {
    if (a.weight !== b.weight) {
      return b.weight - a.weight;
    }
    const aIndex = optionIndexByName.get(a.option) ?? 0;
    const bIndex = optionIndexByName.get(b.option) ?? 0;
    return aIndex - bIndex;
  });
  const top = sortedRanking[0] ?? null;
  const second = sortedRanking[1] ?? null;
  const tie = Boolean(
    top &&
      second &&
      top.weight > 0 &&
      top.weight === second.weight,
  );
  const quorumReached = ballotEntries.length >= quorum;
  const thresholdReached =
    threshold === null ? quorumReached : Boolean(top && top.weight >= threshold);
  const hasWinner = Boolean(top && top.weight > 0 && !tie);
  const winner = hasWinner ? top!.option : null;
  const passed = Boolean(winner && quorumReached && thresholdReached);
  const outcome: VoteResult["outcome"] = passed ? "passed" : "no_consensus";

  const explanationParts = [
    `voters ${ballotEntries.length}`,
    `weight ${participatingWeight}`,
    `quorum ${quorumReached ? "met" : "not met"} (${ballotEntries.length}/${quorum})`,
  ];
  if (threshold !== null) {
    explanationParts.push(
      `threshold ${thresholdReached ? "met" : "not met"} (${top?.weight ?? 0}/${threshold})`,
    );
  }
  if (tie) {
    explanationParts.push("top options are tied");
  }
  if (winner) {
    explanationParts.push(`winner ${winner}`);
  } else {
    explanationParts.push("no winner");
  }

  return {
    version: 1,
    winner,
    ranking: sortedRanking,
    quorum,
    threshold,
    voterCount: ballotEntries.length,
    participatingWeight,
    quorumReached,
    thresholdReached,
    tie,
    outcome,
    explanation: explanationParts.join("; "),
  };
}
