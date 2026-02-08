export type ForkCheckpointTurn = {
  id: string;
  sequence: number;
};

export type ResolvedForkCheckpoint = {
  maxSequence: number;
  checkpointSequence: number;
  checkpointTurnId: string | null;
};

function clampNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.round(value));
}

export function resolveForkCheckpoint(input: {
  turns: ForkCheckpointTurn[];
  requestedSequence: number | null;
}): ResolvedForkCheckpoint {
  const orderedTurns = [...input.turns].sort((a, b) => a.sequence - b.sequence);
  const maxSequence = orderedTurns[orderedTurns.length - 1]?.sequence ?? 0;
  const requested = clampNonNegativeInt(input.requestedSequence);
  const checkpointSequence = Math.min(Math.max(0, requested ?? maxSequence), maxSequence);
  const checkpointTurn = orderedTurns
    .filter((turn) => turn.sequence <= checkpointSequence)
    .slice(-1)[0] ?? null;

  return {
    maxSequence,
    checkpointSequence,
    checkpointTurnId: checkpointTurn?.id ?? null,
  };
}

export function buildForkRunName(input: {
  explicitName: string | null;
  sourceRunName: string | null;
  checkpointSequence: number;
}): string {
  const explicitName = typeof input.explicitName === "string"
    ? input.explicitName.trim().slice(0, 80)
    : "";
  if (explicitName.length > 0) {
    return explicitName;
  }

  const sourceRunName = typeof input.sourceRunName === "string"
    ? input.sourceRunName.trim()
    : "";
  const safeSource = sourceRunName.length > 0 ? sourceRunName : "Run";
  return `${safeSource} Fork T${Math.max(0, Math.round(input.checkpointSequence))}`;
}
