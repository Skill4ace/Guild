import type { ChannelMessageType } from "./board-state";

export type FinalDraftTurnArtifact = {
  kind: string;
  vaultItemId: string;
  name: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  model: string | null;
};

export type FinalDraftTurn = {
  sequence: number;
  status: string;
  actorName: string;
  channelName: string;
  messageType: ChannelMessageType | null;
  summary: string | null;
  rationale: string | null;
  payload: Record<string, unknown> | null;
  artifacts: FinalDraftTurnArtifact[];
  endedAt: string | null;
  startedAt: string | null;
};

export type FinalDraftInput = {
  runName: string | null;
  runObjective: string;
  runStatus: string;
  updatedAt: string | null;
  turns: FinalDraftTurn[];
  vote: {
    status: string | null;
    outcome: string | null;
    winner: string | null;
    explanation: string | null;
    openCount: number;
  } | null;
  deadlock: {
    status: string;
    action: string | null;
    note: string | null;
    signals: string[];
  } | null;
};

export type RunFinalDraftSection = {
  id: string;
  title: string;
  status: "pending" | "building" | "ready";
  lines: string[];
  sourceSequences: number[];
};

export type RunFinalDraftDocument = {
  version: 1;
  synthesisSource: "model" | "deterministic";
  statusLabel: string;
  recommendation: string;
  summary: string;
  updatedAt: string | null;
  generatedAt: string;
  sourceTurnCount: number;
  sections: RunFinalDraftSection[];
  markdown: string;
};

type SectionRow = {
  sequence: number;
  line: string;
};

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function cleanLine(value: string | null | undefined, maxLength = 280): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function cleanBlock(value: string | null | undefined, maxLength = 24_000): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeSequence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.round(value);
  return normalized > 0 ? normalized : null;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function splitToLines(value: string, maxLines: number, maxLength = 280): string[] {
  const compact = value
    .split(/\n+/)
    .map((line) => cleanLine(line, maxLength))
    .filter((line): line is string => line !== null);

  if (compact.length > 0) {
    return compact.slice(0, maxLines);
  }

  const sentenceLines = value
    .split(/(?<=[.!?])\s+/)
    .map((line) => cleanLine(line, maxLength))
    .filter((line): line is string => line !== null)
    .slice(0, maxLines);

  return sentenceLines;
}

function toSection(
  id: string,
  title: string,
  rows: SectionRow[],
  ready: boolean,
): RunFinalDraftSection {
  return {
    id,
    title,
    status: rows.length === 0 ? "pending" : ready ? "ready" : "building",
    lines: rows.map((row) => row.line),
    sourceSequences: uniqueSorted(
      rows
        .map((row) => row.sequence)
        .filter((sequence) => Number.isFinite(sequence) && sequence > 0),
    ),
  };
}

function extractActionLines(turns: FinalDraftTurn[]): SectionRow[] {
  const rows: SectionRow[] = [];

  for (const turn of turns) {
    const payload = asObjectRecord(turn.payload);
    const nextSteps = Array.isArray(payload.nextSteps)
      ? payload.nextSteps
          .map((entry) => cleanLine(typeof entry === "string" ? entry : null, 220))
          .filter((entry): entry is string => entry !== null)
      : [];

    for (const nextStep of nextSteps.slice(0, 2)) {
      rows.push({
        sequence: turn.sequence,
        line: nextStep,
      });
    }
  }

  if (rows.length > 0) {
    return rows.slice(0, 8);
  }

  const decisionTurn = [...turns]
    .reverse()
    .find((turn) => turn.messageType === "decision");
  if (decisionTurn) {
    rows.push({
      sequence: decisionTurn.sequence,
      line: "Convert the final decision into owner-assigned tasks and dates.",
    });
  }

  const blockedTurns = turns.filter((turn) => turn.status === "BLOCKED").length;
  if (blockedTurns > 0) {
    rows.push({
      sequence: Number.MAX_SAFE_INTEGER - 5,
      line: `Resolve ${blockedTurns} blocked turn(s) before re-running execution.`,
    });
  }

  if (rows.length === 0) {
    rows.push({
      sequence: Number.MAX_SAFE_INTEGER - 6,
      line: "No pending actions detected.",
    });
  }

  return rows.slice(0, 8);
}

function buildMarkdown(input: {
  title: string;
  statusLabel: string;
  generatedAt: string;
  recommendation: string;
  summary: string;
  sections: RunFinalDraftSection[];
}): string {
  const lines: string[] = [
    `# ${input.title}`,
    "",
    `Status: ${input.statusLabel}`,
    `Generated: ${input.generatedAt}`,
    "",
    "## Recommendation",
    input.recommendation,
    "",
    "## Executive Summary",
    input.summary,
    "",
  ];

  for (const section of input.sections) {
    lines.push(`## ${section.title}`);
    if (section.lines.length > 0) {
      for (const line of section.lines) {
        lines.push(`- ${line}`);
      }
    } else {
      lines.push("- Pending");
    }

    if (section.sourceSequences.length > 0) {
      lines.push(
        `Source turns: ${section.sourceSequences.map((sequence) => `T${sequence}`).join(", ")}`,
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

function fallbackStatusLabel(input: FinalDraftInput, hasDecision: boolean): string {
  if (hasDecision) {
    return "Final decision ready";
  }

  if (input.runStatus === "RUNNING") {
    return "Draft updating live";
  }

  if (input.runStatus === "BLOCKED") {
    return "Run blocked before final decision";
  }

  return "Run completed";
}

export function buildDeterministicFinalDraft(input: FinalDraftInput): RunFinalDraftDocument {
  const generatedAt = new Date().toISOString();
  const objective =
    cleanLine(input.runObjective, 600) ?? "No mission was set for this run.";
  const orderedTurns = [...input.turns].sort((a, b) => a.sequence - b.sequence);
  const completedTurns = orderedTurns.filter((turn) => turn.status === "COMPLETED");
  const latestTurn = orderedTurns[orderedTurns.length - 1] ?? null;
  const latestCompletedTurn = completedTurns[completedTurns.length - 1] ?? null;
  const decisionTurn =
    [...completedTurns].reverse().find((turn) => turn.messageType === "decision") ?? null;

  const statusLabel = fallbackStatusLabel(input, decisionTurn !== null);
  const recommendation =
    cleanLine(decisionTurn?.summary, 700) ??
    cleanLine(latestCompletedTurn?.summary, 700) ??
    cleanLine(latestTurn?.summary, 700) ??
    "Awaiting turn output.";

  const positionsByActor = new Map<string, FinalDraftTurn>();
  for (const turn of completedTurns) {
    positionsByActor.set(turn.actorName, turn);
  }

  const agentPositionRows: SectionRow[] = Array.from(positionsByActor.values())
    .map((turn) => ({
      sequence: turn.sequence,
      line:
        `${turn.actorName} (${turn.messageType ?? "event"})` +
        `: ${cleanLine(turn.summary, 220) ?? "No summary."}`,
    }))
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-8);

  const evidenceRows: SectionRow[] = completedTurns
    .filter((turn) => turn.messageType === "proposal")
    .map((turn) => ({
      sequence: turn.sequence,
      line: `T${turn.sequence} ${turn.actorName}: ${cleanLine(turn.summary, 220) ?? "No summary."}`,
    }))
    .slice(-8);

  const counterpointRows: SectionRow[] = completedTurns
    .filter((turn) => turn.messageType === "critique")
    .map((turn) => ({
      sequence: turn.sequence,
      line: `T${turn.sequence} ${turn.actorName}: ${cleanLine(turn.summary, 220) ?? "No summary."}`,
    }))
    .slice(-8);

  const artifactRows: SectionRow[] = completedTurns
    .flatMap((turn) =>
      turn.artifacts.map((artifact) => ({
        sequence: turn.sequence,
        line:
          `T${turn.sequence} ${turn.actorName} produced ${artifact.name} (${artifact.mimeType}).` +
          (artifact.model ? ` Model: ${artifact.model}.` : ""),
      })),
    )
    .slice(-8);

  const governanceRows: SectionRow[] = [];
  if (input.vote) {
    const voteLine =
      `Vote ${input.vote.status?.toLowerCase() ?? "unknown"}` +
      (input.vote.outcome ? ` · outcome ${input.vote.outcome}` : "") +
      (input.vote.winner ? ` · winner ${input.vote.winner}` : "");
    governanceRows.push({
      sequence: Number.MAX_SAFE_INTEGER - 2,
      line: voteLine,
    });
    if (input.vote.openCount > 0) {
      governanceRows.push({
        sequence: Number.MAX_SAFE_INTEGER - 3,
        line: `${input.vote.openCount} vote(s) remain open.`,
      });
    }
    if (input.vote.explanation) {
      governanceRows.push({
        sequence: Number.MAX_SAFE_INTEGER - 4,
        line: cleanLine(input.vote.explanation, 220) ?? "Vote explanation unavailable.",
      });
    }
  }
  if (input.deadlock && input.deadlock.status !== "none") {
    governanceRows.push({
      sequence: Number.MAX_SAFE_INTEGER - 5,
      line:
        `Mediation ${input.deadlock.status}` +
        (input.deadlock.action ? ` via ${input.deadlock.action}` : "") +
        (input.deadlock.note ? ` · ${cleanLine(input.deadlock.note, 220)}` : ""),
    });
  }
  if (governanceRows.length === 0) {
    governanceRows.push({
      sequence: Number.MAX_SAFE_INTEGER - 6,
      line: "No vote or mediation events yet.",
    });
  }

  const actionRows = extractActionLines(completedTurns);

  const sections: RunFinalDraftSection[] = [
    toSection("mission", "Mission", [{ sequence: 0, line: objective }], true),
    toSection("positions", "Agent Positions", agentPositionRows, decisionTurn !== null),
    toSection("evidence", "Evidence", evidenceRows, decisionTurn !== null),
    toSection("counterpoints", "Counterpoints", counterpointRows, decisionTurn !== null),
    toSection("artifacts", "Artifacts", artifactRows, decisionTurn !== null),
    toSection("governance", "Governance", governanceRows, true),
    toSection("actions", "Next Actions", actionRows, decisionTurn !== null),
  ];

  const summaryParts = [
    cleanLine(recommendation, 260),
    evidenceRows.length > 0 ? `${evidenceRows.length} evidence item(s).` : null,
    counterpointRows.length > 0 ? `${counterpointRows.length} counterpoint(s).` : null,
    artifactRows.length > 0 ? `${artifactRows.length} artifact reference(s).` : null,
  ].filter((entry): entry is string => entry !== null);

  const title = `${input.runName?.trim() || "Untitled run"} Final Draft`;
  const summary = summaryParts.join(" ").slice(0, 900) || "Awaiting completed turns.";
  const markdown = buildMarkdown({
    title,
    statusLabel,
    generatedAt,
    recommendation,
    summary,
    sections,
  });

  return {
    version: 1,
    synthesisSource: "deterministic",
    statusLabel,
    recommendation,
    summary,
    updatedAt: input.updatedAt,
    generatedAt,
    sourceTurnCount: completedTurns.length,
    sections,
    markdown,
  };
}

function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue
    }
  }

  return null;
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return cleaned.length > 0 ? cleaned : "section";
}

export function normalizeFinalDraftFromModel(input: {
  rawResponseText: string;
  fallback: RunFinalDraftDocument;
}): RunFinalDraftDocument {
  const parsed = parseFirstJsonObject(input.rawResponseText);
  if (!parsed) {
    return input.fallback;
  }

  const recommendation =
    cleanLine(
      typeof parsed.recommendation === "string" ? parsed.recommendation : null,
      900,
    ) ?? input.fallback.recommendation;
  const summary =
    cleanLine(typeof parsed.summary === "string" ? parsed.summary : null, 1200) ??
    input.fallback.summary;
  const statusLabel =
    cleanLine(typeof parsed.statusLabel === "string" ? parsed.statusLabel : null, 120) ??
    input.fallback.statusLabel;

  const sectionsPayload = Array.isArray(parsed.sections) ? parsed.sections : [];
  const rawSections: Array<RunFinalDraftSection | null> = sectionsPayload.map((entry, index) => {
      const section = asObjectRecord(entry);
      const title =
        cleanLine(typeof section.title === "string" ? section.title : null, 80) ??
        `Section ${index + 1}`;
      const id =
        cleanLine(typeof section.id === "string" ? section.id : null, 32) ??
        slugify(title);
      const lineArray = Array.isArray(section.lines)
        ? section.lines
            .map((line) => cleanLine(typeof line === "string" ? line : null, 320))
            .filter((line): line is string => line !== null)
        : [];
      const content =
        lineArray.length === 0 && typeof section.content === "string"
          ? splitToLines(section.content, 8, 320)
          : [];
      const lines = [...lineArray, ...content].slice(0, 10);

      const sourceSequenceList = Array.isArray(section.sourceSequences)
        ? section.sourceSequences
            .map((sequence) => normalizeSequence(sequence))
            .filter((sequence): sequence is number => sequence !== null)
        : Array.isArray(section.sourceTurns)
          ? section.sourceTurns
              .map((sequence) => normalizeSequence(sequence))
              .filter((sequence): sequence is number => sequence !== null)
          : [];

      if (lines.length === 0) {
        return null;
      }

      return {
        id,
        title,
        status: "ready",
        lines,
        sourceSequences: uniqueSorted(sourceSequenceList),
      };
    });
  const sections = rawSections
    .filter((section): section is RunFinalDraftSection => section !== null)
    .slice(0, 10);

  const mergedSections = sections.length > 0 ? sections : input.fallback.sections;

  const markdown =
    cleanBlock(typeof parsed.markdown === "string" ? parsed.markdown : null, 24_000) ??
    buildMarkdown({
      title: "Final Draft",
      statusLabel,
      generatedAt: input.fallback.generatedAt,
      recommendation,
      summary,
      sections: mergedSections,
    });

  return {
    ...input.fallback,
    synthesisSource: "model",
    recommendation,
    summary,
    statusLabel,
    sections: mergedSections,
    markdown,
  };
}
