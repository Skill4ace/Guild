"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RunsConsoleProps = {
  workspaceSlug: string;
};

type RunTurn = {
  id: string;
  sequence: number;
  status: string;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  output: {
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
    artifacts: Array<{
      kind: string;
      vaultItemId: string;
      name: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      model: string | null;
    }>;
  } | null;
  actor: { id: string; name: string } | null;
  channel: { id: string; name: string } | null;
};

type RunSummary = {
  id: string;
  name: string | null;
  objective: string | null;
  status: string;
  template: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkpoint: Record<string, unknown> | null;
  finalDraft: {
    version: number;
    synthesisSource: "model" | "deterministic";
    statusLabel: string;
    recommendation: string;
    summary: string;
    updatedAt: string | null;
    generatedAt: string;
    sourceTurnCount: number;
    sections: DraftSection[];
    markdown: string;
  } | null;
  counts: {
    total: number;
    queued: number;
    running: number;
    blocked: number;
    done: number;
  };
  votes: {
    counts: {
      total: number;
      open: number;
      closed: number;
      canceled: number;
    };
    latest: {
      id: string;
      status: string;
      question: string;
      quorum: number | null;
      threshold: number | null;
      outcome: string | null;
      winner: string | null;
      explanation: string | null;
      openedAt: string;
      closedAt: string | null;
      updatedAt: string;
    } | null;
  };
  deadlock: {
    status: string;
    action: string | null;
    note: string | null;
    signals: string[];
    turnSequence: number;
  } | null;
  provenance: {
    sourceRunId: string;
    sourceRunName: string | null;
    sourceWorkspaceId: string | null;
    sourceCheckpointSequence: number;
    sourceCheckpointTurnId: string | null;
    sourceTurnCount: number;
    sourceRunStatus: string | null;
    sourceUpdatedAt: string | null;
    forkedAt: string;
  } | null;
  turns: RunTurn[];
};

type RunsPayload = {
  workspace: {
    id: string;
    slug: string;
    name: string;
    defaultObjective: string | null;
  };
  runs: RunSummary[];
};

type ExecutePayload = {
  run?: {
    id: string;
    status: string;
  } | null;
  execution?: {
    status: string;
    processedAttempts: number;
    completedTurns: number;
    blockedTurns: number;
    skippedTurns: number;
    retriesUsed: number;
    decisionReached: boolean;
    deadlock?: {
      status: string;
      action: string | null;
      note: string | null;
      signals: string[];
    };
  } | null;
  error?: string;
};

type RuntimePayload = {
  maxRetries: number;
  turnTimeoutMs: number;
  transientFailureSequences: number[];
  timeoutFailureSequences: number[];
};

type CreateRunPayload = {
  run?: {
    id: string;
    name: string | null;
    status: string;
  } | null;
  error?: string;
};

type LoadRunsOptions = {
  quiet?: boolean;
};

type DraftSection = {
  id: string;
  title: string;
  status: "pending" | "building" | "ready";
  lines: string[];
  sourceSequences: number[];
};

type WorkingDraft = {
  statusLabel: string;
  recommendation: string;
  updatedAt: string | null;
  sections: DraftSection[];
  markdown: string;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function parseSequenceCsv(value: string): number[] {
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.round(entry))
    .filter((entry, index, collection) => collection.indexOf(entry) === index);
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return `${payload.error} [${response.status}]`;
    }
  } catch {
    // ignore JSON parse failures
  }

  return `Request failed [${response.status}]`;
}

function checkpointNote(checkpoint: Record<string, unknown> | null): string {
  if (!checkpoint) {
    return "No checkpoint yet.";
  }

  const note = checkpoint.note;
  return typeof note === "string" && note.length > 0
    ? note
    : "Checkpoint recorded.";
}

function cleanSummary(value: string | null | undefined, maxLength = 220): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function buildWorkingDraft(run: RunSummary | null): WorkingDraft {
  if (!run) {
    const emptyMarkdown = [
      "# Decision Draft",
      "",
      "No run selected.",
    ].join("\n");
    return {
      statusLabel: "No run selected",
      recommendation: "No recommendation yet.",
      updatedAt: null,
      sections: [],
      markdown: emptyMarkdown,
    };
  }

  if (run.finalDraft) {
    return {
      statusLabel: run.finalDraft.statusLabel,
      recommendation: run.finalDraft.recommendation,
      updatedAt: run.finalDraft.updatedAt ?? run.finalDraft.generatedAt,
      sections: run.finalDraft.sections,
      markdown: run.finalDraft.markdown || run.finalDraft.recommendation,
    };
  }

  const mission =
    cleanSummary(run.objective, 480) ?? "No mission was set for this run.";
  const orderedTurns = [...run.turns].sort((a, b) => a.sequence - b.sequence);
  const completedTurns = orderedTurns.filter((turn) => turn.status === "COMPLETED");
  const latestTurn = orderedTurns[orderedTurns.length - 1] ?? null;
  const latestCompletedTurn = completedTurns[completedTurns.length - 1] ?? null;
  const decisionTurn =
    [...completedTurns]
      .reverse()
      .find((turn) => turn.output?.messageType === "decision") ?? null;
  const proposalTurns = completedTurns.filter(
    (turn) => turn.output?.messageType === "proposal",
  );
  const critiqueTurns = completedTurns.filter(
    (turn) => turn.output?.messageType === "critique",
  );

  const positionByActor = new Map<string, RunTurn>();
  for (const turn of completedTurns) {
    const actorName = turn.actor?.name ?? "Unknown actor";
    positionByActor.set(actorName, turn);
  }

  const argumentLines = Array.from(positionByActor.entries())
    .map(([, turn]) => {
      const actorName = turn.actor?.name ?? "Unknown actor";
      const summary = cleanSummary(turn.output?.summary, 180) ?? "No summary.";
      const messageType = turn.output?.messageType ?? "event";
      return {
        sequence: turn.sequence,
        line: `${actorName} (${messageType}): ${summary}`,
      };
    })
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-6);

  const evidenceLines = proposalTurns
    .map((turn) => {
      const actorName = turn.actor?.name ?? "Unknown actor";
      const summary = cleanSummary(turn.output?.summary, 180) ?? "No summary.";
      return {
        sequence: turn.sequence,
        line: `T${turn.sequence} ${actorName}: ${summary}`,
      };
    })
    .slice(-6);

  const critiqueLines = critiqueTurns
    .map((turn) => {
      const actorName = turn.actor?.name ?? "Unknown actor";
      const summary = cleanSummary(turn.output?.summary, 180) ?? "No summary.";
      return {
        sequence: turn.sequence,
        line: `T${turn.sequence} ${actorName}: ${summary}`,
      };
    })
    .slice(-6);

  const governanceLines: Array<{ sequence: number; line: string }> = [];
  if (run.votes.latest) {
    governanceLines.push({
      sequence: Number.MAX_SAFE_INTEGER - 2,
      line:
        `Vote ${run.votes.latest.status.toLowerCase()}` +
        (run.votes.latest.winner ? ` · winner ${run.votes.latest.winner}` : "") +
        (run.votes.latest.outcome ? ` · outcome ${run.votes.latest.outcome}` : ""),
    });
  }
  if (run.deadlock) {
    governanceLines.push({
      sequence: run.deadlock.turnSequence,
      line:
        `Mediation ${run.deadlock.status}` +
        (run.deadlock.note ? ` · ${cleanSummary(run.deadlock.note, 140)}` : ""),
    });
  }
  if (!run.votes.latest && !run.deadlock) {
    governanceLines.push({
      sequence: Number.MAX_SAFE_INTEGER - 1,
      line: "No vote or mediation events yet.",
    });
  }

  const unresolvedCritiques = decisionTurn ? 0 : critiqueTurns.length;
  const actionLines: Array<{ sequence: number; line: string }> = [];
  if (decisionTurn) {
    actionLines.push({
      sequence: decisionTurn.sequence,
      line:
        "Convert the decision into owner-assigned execution tasks with due dates.",
    });
  }
  if (unresolvedCritiques > 0) {
    actionLines.push({
      sequence: Number.MAX_SAFE_INTEGER - 4,
      line: `Resolve ${unresolvedCritiques} open critique turn(s) before locking a final decision.`,
    });
  }
  if (run.votes.counts.open > 0) {
    actionLines.push({
      sequence: Number.MAX_SAFE_INTEGER - 3,
      line: `Close ${run.votes.counts.open} open vote(s).`,
    });
  }
  if (actionLines.length === 0) {
    actionLines.push({
      sequence: Number.MAX_SAFE_INTEGER - 5,
      line: "Run completed with no pending governance actions.",
    });
  }

  const recommendation =
    cleanSummary(decisionTurn?.output?.summary, 280) ??
    cleanSummary(latestCompletedTurn?.output?.summary, 280) ??
    cleanSummary(latestTurn?.output?.summary, 280) ??
    "Awaiting turn output.";
  const statusLabel = decisionTurn
    ? "Final decision ready"
    : run.status === "RUNNING"
      ? "Draft updating live"
      : run.status === "BLOCKED"
        ? "Run blocked before final decision"
        : "Run completed";

  const toSection = (
    id: string,
    title: string,
    rows: Array<{ sequence: number; line: string }>,
  ): DraftSection => ({
    id,
    title,
    status:
      rows.length === 0 ? "pending" : decisionTurn ? "ready" : "building",
    lines: rows.map((row) => row.line),
    sourceSequences: uniqueSortedNumbers(
      rows
        .map((row) => row.sequence)
        .filter(
          (sequence) =>
            Number.isFinite(sequence) && sequence > 0 && sequence < Number.MAX_SAFE_INTEGER / 2,
        ),
    ),
  });

  const sections: DraftSection[] = [
    toSection("mission", "Mission", [{ sequence: 0, line: mission }]),
    toSection("arguments", "Agent Positions", argumentLines),
    toSection("evidence", "Evidence and Claims", evidenceLines),
    toSection("counterpoints", "Counterpoints", critiqueLines),
    toSection("governance", "Governance and Votes", governanceLines),
    toSection("actions", "Next Actions", actionLines),
  ];

  const markdownLines: string[] = [
    `# ${(run.name?.trim() || "Untitled run")} Decision Draft`,
    "",
    `Status: ${statusLabel}`,
    `Updated: ${formatDate(latestTurn?.endedAt ?? latestTurn?.startedAt ?? run.updatedAt)}`,
    "",
    "## Recommendation",
    recommendation,
    "",
  ];

  for (const section of sections) {
    markdownLines.push(`## ${section.title}`);
    if (section.lines.length > 0) {
      for (const line of section.lines) {
        markdownLines.push(`- ${line}`);
      }
    } else {
      markdownLines.push("- Pending");
    }
    markdownLines.push("");
  }

  return {
    statusLabel,
    recommendation,
    updatedAt: latestTurn?.endedAt ?? latestTurn?.startedAt ?? run.updatedAt,
    sections,
    markdown: markdownLines.join("\n"),
  };
}

function runStatusBadgeClass(status: string): string {
  if (status === "RUNNING") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (status === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "BLOCKED" || status === "FAILED") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "QUEUED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function turnStatusAccentClass(status: string): string {
  if (status === "RUNNING") {
    return "border-blue-300 bg-blue-50/60";
  }
  if (status === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50/60";
  }
  if (status === "BLOCKED" || status === "FAILED") {
    return "border-rose-200 bg-rose-50/60";
  }
  if (status === "SKIPPED") {
    return "border-amber-200 bg-amber-50/60";
  }
  return "border-slate-200 bg-white";
}

export function RunsConsole({ workspaceSlug }: RunsConsoleProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [quietRefreshing, setQuietRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [newRunName, setNewRunName] = useState("New Run");
  const [newRunObjective, setNewRunObjective] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [maxRetries, setMaxRetries] = useState(2);
  const [turnTimeoutMs, setTurnTimeoutMs] = useState(30000);
  const [transientSeqCsv, setTransientSeqCsv] = useState("");
  const [timeoutSeqCsv, setTimeoutSeqCsv] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);

  const runtimePayload = useMemo<RuntimePayload>(
    () => ({
      maxRetries,
      turnTimeoutMs,
      transientFailureSequences: parseSequenceCsv(transientSeqCsv),
      timeoutFailureSequences: parseSequenceCsv(timeoutSeqCsv),
    }),
    [maxRetries, timeoutSeqCsv, transientSeqCsv, turnTimeoutMs],
  );
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );
  const sortedTurns = useMemo(
    () => [...(selectedRun?.turns ?? [])].sort((a, b) => a.sequence - b.sequence),
    [selectedRun],
  );
  const latestTurn = sortedTurns.length > 0 ? sortedTurns[sortedTurns.length - 1] : null;
  const workingDraft = useMemo(() => buildWorkingDraft(selectedRun), [selectedRun]);
  const hasInFlightExecution =
    actionRunId !== null && actionRunId !== "new" && !actionRunId.startsWith("fork:");
  const shouldLiveRefresh =
    autoRefreshEnabled && (selectedRun?.status === "RUNNING" || hasInFlightExecution);
  const totalTurns = selectedRun?.counts.total ?? 0;
  const settledTurns =
    (selectedRun?.counts.done ?? 0) + (selectedRun?.counts.blocked ?? 0);
  const completionPercent =
    totalTurns > 0
      ? Math.max(0, Math.min(100, Math.round((settledTurns / totalTurns) * 100)))
      : 0;

  const loadRuns = useCallback(
    async (options: LoadRunsOptions = {}) => {
      if (options.quiet) {
        setQuietRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const response = await fetch(`/api/workspaces/${workspaceSlug}/runs`, {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response));
        }

        const payload = (await response.json()) as RunsPayload;
        setRuns(payload.runs ?? []);
        setNewRunObjective((current) => {
          if (current.trim().length > 0) {
            return current;
          }

          return payload.workspace.defaultObjective ?? "";
        });
      } catch (loadError) {
        if (!options.quiet) {
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load runs.",
          );
        }
      } finally {
        if (options.quiet) {
          setQuietRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [workspaceSlug],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }

    const hasSelected = selectedRunId ? runs.some((run) => run.id === selectedRunId) : false;
    if (!hasSelected) {
      setSelectedRunId(runs[0]?.id ?? null);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!shouldLiveRefresh) {
      return;
    }

    let isPolling = false;
    const poll = async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        await loadRuns({ quiet: true });
      } finally {
        isPolling = false;
      }
    };

    void poll();
    const timerId = window.setInterval(() => {
      void poll();
    }, 1100);

    return () => window.clearInterval(timerId);
  }, [loadRuns, shouldLiveRefresh]);

  async function copyWorkingDraft() {
    try {
      await navigator.clipboard.writeText(workingDraft.markdown);
      setDraftCopied(true);
      window.setTimeout(() => {
        setDraftCopied(false);
      }, 1400);
    } catch {
      setError("Failed to copy draft.");
    }
  }

  async function createRunRequest(
    name: string,
    objective: string,
    runtime: RuntimePayload,
  ): Promise<string> {
    const response = await fetch(`/api/workspaces/${workspaceSlug}/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        objective: objective.trim() || undefined,
        runtime,
      }),
    });

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    const payload = (await response.json()) as CreateRunPayload;
    const runId = payload.run?.id;
    if (!runId) {
      throw new Error("Run creation succeeded but no run id was returned.");
    }

    return runId;
  }

  async function createRun() {
    setActionRunId("new");
    setError(null);
    setMessage(null);

    try {
      const runId = await createRunRequest(newRunName, newRunObjective, runtimePayload);
      setMessage("Draft run created. Execute it when you are ready.");
      await loadRuns();
      setSelectedRunId(runId);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create run.",
      );
    } finally {
      setActionRunId(null);
    }
  }

  async function executeRun(runId: string) {
    setSelectedRunId(runId);
    setActionRunId(runId);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/runs/${runId}/execute`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            runtime: runtimePayload,
          }),
        },
      );

      const payload = (await response.json()) as ExecutePayload;
      if (!response.ok) {
        throw new Error(payload.error || `Execution failed [${response.status}]`);
      }

      if (payload.execution) {
        const deadlockSuffix =
          payload.execution.deadlock &&
          payload.execution.deadlock.status !== "none"
            ? ` Deadlock ${payload.execution.deadlock.status}${
                payload.execution.deadlock.action
                  ? ` via ${payload.execution.deadlock.action}`
                  : ""
              }.`
            : "";
        setMessage(
          `Run ${payload.execution.status}. Attempts ${payload.execution.processedAttempts}, retries ${payload.execution.retriesUsed}.${deadlockSuffix}`,
        );
      } else {
        setMessage("Run executed.");
      }

      await loadRuns({ quiet: true });
    } catch (executeError) {
      setError(
        executeError instanceof Error
          ? executeError.message
          : "Failed to execute run.",
      );
    } finally {
      setActionRunId(null);
    }
  }
  const selectedMission = selectedRun?.objective?.trim() || "No mission set.";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Runs</h3>
        <div className="flex items-center gap-2">
          {quietRefreshing ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
              Updating...
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void loadRuns()}
            disabled={loading || actionRunId !== null}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="grid gap-3 lg:grid-cols-[260px_1fr_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-700">Run name</span>
            <input
              type="text"
              value={newRunName}
              onChange={(event) => setNewRunName(event.target.value)}
              placeholder="New run name"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-700">Run mission</span>
            <input
              type="text"
              value={newRunObjective}
              onChange={(event) => setNewRunObjective(event.target.value)}
              placeholder="What should the agent system decide or deliver?"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
            />
          </label>
          <button
            type="button"
            onClick={() => void createRun()}
            disabled={actionRunId !== null}
            className="self-end rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {actionRunId === "new" ? "Creating..." : "Create run"}
          </button>
        </div>

        <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Advanced runtime settings
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">Max retries</span>
              <input
                type="number"
                min={0}
                max={5}
                value={maxRetries}
                onChange={(event) => setMaxRetries(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">Timeout (ms)</span>
              <input
                type="number"
                min={500}
                max={60000}
                value={turnTimeoutMs}
                onChange={(event) => setTurnTimeoutMs(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">
                Simulate transient failures (turn sequences CSV)
              </span>
              <input
                type="text"
                value={transientSeqCsv}
                onChange={(event) => setTransientSeqCsv(event.target.value)}
                placeholder="2,4"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">
                Simulate timeout failures (turn sequences CSV)
              </span>
              <input
                type="text"
                value={timeoutSeqCsv}
                onChange={(event) => setTimeoutSeqCsv(event.target.value)}
                placeholder="3"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
              />
            </label>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(event) => setAutoRefreshEnabled(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            Auto-refresh while run is active
          </label>
          <label className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-slate-600">
            <input
              type="checkbox"
              checked={showDiagnostics}
              onChange={(event) => setShowDiagnostics(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            Show detailed Gemini diagnostics
          </label>
        </details>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          {message}
        </p>
      ) : null}

      {runs.length === 0 || !selectedRun ? (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          No runs yet.
        </p>
      ) : (
        <section className="mt-4 grid gap-3 xl:grid-cols-[1.45fr_0.55fr]">
          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-700">Selected run</span>
                <select
                  value={selectedRun.id}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {(run.name?.trim() || "Untitled run") + ` (${run.status})`}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${runStatusBadgeClass(
                    selectedRun.status,
                  )}`}
                >
                  {selectedRun.status}
                </span>
                <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                  {selectedRun.template}
                </span>
                <button
                  type="button"
                  onClick={() => void executeRun(selectedRun.id)}
                  disabled={actionRunId !== null || selectedRun.status === "RUNNING"}
                  className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionRunId === selectedRun.id ? "Running..." : "Run"}
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Mission
              </p>
              <p className="mt-1 text-sm text-slate-900">{selectedMission}</p>
            </div>

            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                <span>Progress</span>
                <span>
                  {settledTurns}/{totalTurns} turns settled
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${
                    selectedRun.status === "BLOCKED"
                      ? "bg-rose-400"
                      : selectedRun.status === "COMPLETED"
                        ? "bg-emerald-500"
                        : "bg-blue-500"
                  }`}
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                turns {selectedRun.counts.total}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                running {selectedRun.counts.running}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                queued {selectedRun.counts.queued}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                done {selectedRun.counts.done}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                blocked {selectedRun.counts.blocked}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
                votes open {selectedRun.votes.counts.open}
              </span>
            </div>

            <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">
                  Turns
                </p>
                {latestTurn ? (
                  <p className="text-[11px] text-slate-500">
                    Latest T{latestTurn.sequence} · {formatDate(latestTurn.endedAt ?? latestTurn.startedAt)}
                  </p>
                ) : null}
              </div>

              {sortedTurns.length > 0 ? (
                <ol className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                  {sortedTurns.map((turn) => (
                    <li
                      key={turn.id}
                      className={`rounded-lg border px-3 py-2 ${turnStatusAccentClass(turn.status)}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">
                          T{turn.sequence} · {turn.status}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatDate(turn.endedAt ?? turn.startedAt)}
                        </p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {(turn.actor?.name ?? "Unknown actor") +
                          " via " +
                          (turn.channel?.name ?? "Unknown channel")}
                      </p>
                      <p className="mt-1 text-sm text-slate-900">
                        {turn.output?.summary?.trim() ||
                          (turn.status === "RUNNING"
                            ? "Processing turn..."
                            : turn.status === "QUEUED"
                              ? "Queued for execution."
                              : "No summary available.")}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span>{turn.output?.messageType ?? "event"}</span>
                        <span>
                          tools {turn.output?.toolSummary.executed ?? 0}/
                          {turn.output?.toolSummary.requested ?? 0}
                        </span>
                        {turn.output?.consensus.voteId ? (
                          <span>
                            vote {turn.output.consensus.status?.toLowerCase() ?? "open"}
                          </span>
                        ) : null}
                      </div>
                      {turn.output?.artifacts.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {turn.output.artifacts.map((artifact) => (
                            <a
                              key={`${turn.id}-${artifact.vaultItemId}`}
                              href={`/api/workspaces/${workspaceSlug}/vault/${artifact.vaultItemId}/download?inline=1`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700"
                            >
                              Image output
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {turn.error ? (
                        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                          {turn.error}
                        </p>
                      ) : null}
                      {showDiagnostics && turn.output ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          {turn.output.model ? `model ${turn.output.model}` : "model n/a"}
                          {turn.output.thinkingLevel
                            ? ` · thinking ${turn.output.thinkingLevel}`
                            : ""}
                          {turn.output.latencyMs !== null &&
                          turn.output.latencyMs !== undefined
                            ? ` · ${turn.output.latencyMs}ms`
                            : ""}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  No turns yet.
                </p>
              )}
            </section>
          </section>

          <div className="space-y-3">
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">
                  Final Draft
                </p>
                <button
                  type="button"
                  onClick={() => void copyWorkingDraft()}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {draftCopied ? "Copied" : "Copy"}
                </button>
              </div>

              <p className="mt-2 text-sm font-semibold text-slate-900">
                {workingDraft.recommendation}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {workingDraft.statusLabel}
                {workingDraft.updatedAt ? ` · ${formatDate(workingDraft.updatedAt)}` : ""}
              </p>

              <div className="mt-3 max-h-[560px] space-y-3 overflow-y-auto pr-1">
                {workingDraft.sections.map((section) => (
                  <article
                    key={section.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-800">{section.title}</p>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                          section.status === "ready"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : section.status === "building"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-500"
                        }`}
                      >
                        {section.status}
                      </span>
                    </div>
                    {section.lines.length > 0 ? (
                      <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
                        {section.lines.map((line, index) => (
                          <li key={`${section.id}-${index}`}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5 text-xs text-slate-500">Pending</p>
                    )}
                    {section.sourceSequences.length > 0 ? (
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        Source turns:{" "}
                        {section.sourceSequences.map((sequence) => `T${sequence}`).join(", ")}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-slate-500">
                checkpoint: {checkpointNote(selectedRun.checkpoint)}
              </p>
            </section>
          </div>
        </section>
      )}
    </section>
  );
}
