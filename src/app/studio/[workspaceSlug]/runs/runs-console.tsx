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

type ForkRunPayload = {
  run?: {
    id: string;
    name: string | null;
    status: string;
  } | null;
  provenance?: {
    sourceRunId: string;
    sourceRunName: string | null;
    sourceCheckpointSequence: number;
  } | null;
  error?: string;
};

type TimelineEvent = {
  id: string;
  sequence: number;
  status: string;
  label: string;
  timestamp: string | null;
  detail: string;
  error: string | null;
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

export function RunsConsole({ workspaceSlug }: RunsConsoleProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [newRunName, setNewRunName] = useState("New Run");
  const [newRunObjective, setNewRunObjective] = useState("");
  const [forkRunName, setForkRunName] = useState("");
  const [selectedTimelineRunId, setSelectedTimelineRunId] = useState<
    string | null
  >(null);
  const [replayCursor, setReplayCursor] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [maxRetries, setMaxRetries] = useState(2);
  const [turnTimeoutMs, setTurnTimeoutMs] = useState(30000);
  const [transientSeqCsv, setTransientSeqCsv] = useState("");
  const [timeoutSeqCsv, setTimeoutSeqCsv] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const runtimePayload = useMemo<RuntimePayload>(
    () => ({
      maxRetries,
      turnTimeoutMs,
      transientFailureSequences: parseSequenceCsv(transientSeqCsv),
      timeoutFailureSequences: parseSequenceCsv(timeoutSeqCsv),
    }),
    [maxRetries, timeoutSeqCsv, transientSeqCsv, turnTimeoutMs],
  );
  const selectedTimelineRun = useMemo(
    () =>
      runs.find((run) => run.id === selectedTimelineRunId) ??
      runs[0] ??
      null,
    [runs, selectedTimelineRunId],
  );
  const timelineEvents = useMemo<TimelineEvent[]>(
    () =>
      (selectedTimelineRun?.turns ?? [])
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((turn) => {
          const messageType = turn.output?.messageType ?? "event";
          const detailParts = [
            turn.actor?.name ?? "Unknown actor",
            turn.channel?.name ?? "Unknown channel",
            messageType,
          ];

          if (turn.output?.summary) {
            detailParts.push(turn.output.summary);
          }

          return {
            id: turn.id,
            sequence: turn.sequence,
            status: turn.status,
            label: `T${turn.sequence} ${turn.status}`,
            timestamp: turn.endedAt ?? turn.startedAt,
            detail: detailParts.join(" · "),
            error: turn.error,
          };
        }),
    [selectedTimelineRun],
  );
  const replayMaxCursor = timelineEvents.length;
  const replayActiveEvent =
    replayCursor > 0 ? timelineEvents[replayCursor - 1] ?? null : null;
  const replayActiveTurn = useMemo(
    () =>
      replayActiveEvent
        ? selectedTimelineRun?.turns.find((turn) => turn.id === replayActiveEvent.id) ??
          null
        : null,
    [replayActiveEvent, selectedTimelineRun],
  );
  const finalOutcomeTurn = useMemo(() => {
    if (!selectedTimelineRun) {
      return null;
    }

    const orderedTurns = [...selectedTimelineRun.turns].sort(
      (a, b) => a.sequence - b.sequence,
    );

    for (let index = orderedTurns.length - 1; index >= 0; index -= 1) {
      const turn = orderedTurns[index];
      if (turn.status === "COMPLETED" && turn.output?.messageType === "decision") {
        return turn;
      }
    }

    for (let index = orderedTurns.length - 1; index >= 0; index -= 1) {
      const turn = orderedTurns[index];
      if (turn.status === "COMPLETED") {
        return turn;
      }
    }

    return orderedTurns[orderedTurns.length - 1] ?? null;
  }, [selectedTimelineRun]);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);

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
      setError(loadError instanceof Error ? loadError.message : "Failed to load runs.");
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedTimelineRunId(null);
      setReplayCursor(0);
      setReplayPlaying(false);
      return;
    }

    const hasSelected = selectedTimelineRunId
      ? runs.some((run) => run.id === selectedTimelineRunId)
      : false;
    if (!hasSelected) {
      setSelectedTimelineRunId(runs[0]?.id ?? null);
    }
  }, [runs, selectedTimelineRunId]);

  useEffect(() => {
    setReplayCursor(replayMaxCursor);
    setReplayPlaying(false);
  }, [selectedTimelineRun?.id, replayMaxCursor]);

  useEffect(() => {
    if (!replayPlaying) {
      return;
    }

    if (replayCursor >= replayMaxCursor) {
      setReplayPlaying(false);
      return;
    }

    const timerId = window.setInterval(() => {
      setReplayCursor((current) => {
        if (current >= replayMaxCursor) {
          window.clearInterval(timerId);
          return current;
        }

        return current + 1;
      });
    }, 900);

    return () => {
      window.clearInterval(timerId);
    };
  }, [replayCursor, replayMaxCursor, replayPlaying]);

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
      await createRunRequest(newRunName, newRunObjective, runtimePayload);
      setMessage("Draft run created. Execute it when you are ready.");
      await loadRuns();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create run.",
      );
    } finally {
      setActionRunId(null);
    }
  }

  async function executeRun(runId: string) {
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

      await loadRuns();
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

  async function forkRunFromReplay() {
    if (!selectedTimelineRun) {
      return;
    }

    const checkpointSequence = replayActiveEvent?.sequence ?? 0;
    setActionRunId(`fork:${selectedTimelineRun.id}`);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/runs/${selectedTimelineRun.id}/fork`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: forkRunName.trim() || undefined,
            checkpointSequence,
          }),
        },
      );
      const payload = (await response.json()) as ForkRunPayload;
      if (!response.ok) {
        throw new Error(payload.error || `Fork failed [${response.status}]`);
      }

      const newRunId = payload.run?.id ?? null;
      setForkRunName("");
      setMessage(
        `Fork created at T${checkpointSequence}${
          payload.provenance?.sourceRunName
            ? ` from ${payload.provenance.sourceRunName}`
            : ""
        }.`,
      );
      await loadRuns();
      if (newRunId) {
        setSelectedTimelineRunId(newRunId);
      }
    } catch (forkError) {
      setError(forkError instanceof Error ? forkError.message : "Fork failed.");
    } finally {
      setActionRunId(null);
    }
  }

  const selectedMission =
    selectedTimelineRun?.objective?.trim() ||
    "No mission set. Define one in Board or Run mission.";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Run Console</h3>
        <button
          type="button"
          onClick={() => void loadRuns()}
          disabled={loading || actionRunId !== null}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[260px_1fr_auto]">
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
          {actionRunId === "new" ? "Creating..." : "Create draft run"}
        </button>
      </div>

      <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
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
            checked={showDiagnostics}
            onChange={(event) => setShowDiagnostics(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          Show detailed Gemini diagnostics per turn
        </label>
      </details>

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

      {runs.length === 0 || !selectedTimelineRun ? (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          No runs yet. Create a draft run and execute it from this panel.
        </p>
      ) : (
        <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">Selected run</span>
              <select
                value={selectedTimelineRun.id}
                onChange={(event) => setSelectedTimelineRunId(event.target.value)}
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
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                {selectedTimelineRun.status}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                {selectedTimelineRun.template}
              </span>
              <button
                type="button"
                onClick={() => void executeRun(selectedTimelineRun.id)}
                disabled={
                  actionRunId !== null || selectedTimelineRun.status === "RUNNING"
                }
                className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionRunId === selectedTimelineRun.id
                  ? "Running..."
                  : "Execute scheduler"}
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Mission
            </p>
            <p className="mt-1 text-sm text-slate-900">{selectedMission}</p>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
              turns {selectedTimelineRun.counts.total}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
              queued {selectedTimelineRun.counts.queued}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
              done {selectedTimelineRun.counts.done}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
              blocked {selectedTimelineRun.counts.blocked}
            </span>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5">
              votes open {selectedTimelineRun.votes.counts.open}
            </span>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_0.6fr]">
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">
                Timeline Replay
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayCursor(0);
                  }}
                  disabled={actionRunId !== null || replayCursor === 0}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayCursor((value) => Math.max(0, value - 1));
                  }}
                  disabled={actionRunId !== null || replayCursor === 0}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setReplayPlaying((value) => !value)}
                  disabled={actionRunId !== null || replayMaxCursor === 0}
                  className="rounded-md border border-slate-900 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {replayPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayCursor((value) => Math.min(replayMaxCursor, value + 1));
                  }}
                  disabled={actionRunId !== null || replayCursor >= replayMaxCursor}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplayPlaying(false);
                    setReplayCursor(replayMaxCursor);
                  }}
                  disabled={
                    actionRunId !== null ||
                    replayMaxCursor === 0 ||
                    replayCursor === replayMaxCursor
                  }
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Latest
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <input
                  type="range"
                  min={0}
                  max={replayMaxCursor}
                  value={replayCursor}
                  onChange={(event) => {
                    setReplayPlaying(false);
                    setReplayCursor(Number(event.target.value));
                  }}
                  className="w-full"
                />
                <p className="text-xs text-slate-600">
                  Checkpoint:{" "}
                  <span className="font-semibold text-slate-900">
                    {replayActiveEvent ? `T${replayActiveEvent.sequence}` : "Run start"}
                  </span>{" "}
                  | Cursor {replayCursor}/{replayMaxCursor}
                </p>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                  {replayActiveEvent
                    ? `${replayActiveEvent.label} · ${replayActiveEvent.detail}${
                        replayActiveEvent.error ? ` · ${replayActiveEvent.error}` : ""
                      }`
                    : "No turn selected yet."}
                </p>
              </div>

              {timelineEvents.length > 0 ? (
                <ol className="mt-3 max-h-[420px] space-y-1 overflow-y-auto pr-1">
                  {timelineEvents.map((event, index) => {
                    const isVisible = index < replayCursor;
                    const isActive = index + 1 === replayCursor;
                    return (
                      <li
                        key={event.id}
                        className={`rounded-md border px-2 py-1.5 text-xs ${
                          isActive
                            ? "border-slate-900 bg-slate-900 text-white"
                            : isVisible
                              ? "border-slate-300 bg-white text-slate-800"
                              : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        <span className="font-semibold">{event.label}</span>
                        {" · "}
                        {event.detail}
                        {event.timestamp ? ` · ${formatDate(event.timestamp)}` : ""}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  No activity yet.
                </p>
              )}
            </section>

            <div className="space-y-3">
              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">
                  Final Output
                </p>
                {finalOutcomeTurn?.output?.summary ? (
                  <>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {finalOutcomeTurn.output.summary}
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      T{finalOutcomeTurn.sequence} · {finalOutcomeTurn.status} ·{" "}
                      {finalOutcomeTurn.output.messageType ?? "event"}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-slate-600">
                    Final output appears here after turns complete.
                  </p>
                )}

                {showDiagnostics && finalOutcomeTurn?.output ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    {finalOutcomeTurn.output.model
                      ? `model ${finalOutcomeTurn.output.model}`
                      : "model n/a"}
                    {finalOutcomeTurn.output.thinkingLevel
                      ? ` · thinking ${finalOutcomeTurn.output.thinkingLevel}`
                      : ""}
                    {finalOutcomeTurn.output.routeReason
                      ? ` · route ${finalOutcomeTurn.output.routeReason}`
                      : ""}
                    {finalOutcomeTurn.output.latencyMs !== null &&
                    finalOutcomeTurn.output.latencyMs !== undefined
                      ? ` · ${finalOutcomeTurn.output.latencyMs}ms`
                      : ""}
                  </p>
                ) : null}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">
                  Run Details
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  checkpoint: {checkpointNote(selectedTimelineRun.checkpoint)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  updated {formatDate(selectedTimelineRun.updatedAt)} | started{" "}
                  {formatDate(selectedTimelineRun.startedAt)} | ended{" "}
                  {formatDate(selectedTimelineRun.endedAt)}
                </p>
                {selectedTimelineRun.provenance ? (
                  <p className="mt-1 text-xs text-slate-500">
                    forked from{" "}
                    <span className="font-semibold">
                      {selectedTimelineRun.provenance.sourceRunName?.trim() ||
                        selectedTimelineRun.provenance.sourceRunId}
                    </span>{" "}
                    at T{selectedTimelineRun.provenance.sourceCheckpointSequence}
                  </p>
                ) : null}
                {selectedTimelineRun.deadlock ? (
                  <p className="mt-1 text-xs text-slate-500">
                    mediation: {selectedTimelineRun.deadlock.status}
                    {selectedTimelineRun.deadlock.action
                      ? ` (${selectedTimelineRun.deadlock.action})`
                      : ""}
                    {selectedTimelineRun.deadlock.note
                      ? ` · ${selectedTimelineRun.deadlock.note}`
                      : ""}
                  </p>
                ) : null}
                {replayActiveTurn?.error ? (
                  <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    Replay turn error: {replayActiveTurn.error}
                  </p>
                ) : null}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-700">
                  Fork From Checkpoint
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Source: {selectedTimelineRun.name?.trim() || "Untitled run"} at{" "}
                  {replayActiveEvent ? `T${replayActiveEvent.sequence}` : "run start"}.
                </p>
                <label className="mt-3 block space-y-1">
                  <span className="text-xs font-medium text-slate-700">
                    Fork name (optional)
                  </span>
                  <input
                    type="text"
                    value={forkRunName}
                    onChange={(event) => setForkRunName(event.target.value)}
                    placeholder="Design review fork"
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void forkRunFromReplay()}
                  disabled={actionRunId !== null}
                  className="mt-3 w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionRunId === `fork:${selectedTimelineRun.id}`
                    ? "Forking..."
                    : "Fork from checkpoint"}
                </button>
              </section>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
