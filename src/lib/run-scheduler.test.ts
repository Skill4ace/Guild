import { describe, expect, it } from "vitest";

import type { CompiledTurnCandidate } from "./run-compiler";
import {
  DEFAULT_SCHEDULER_RUNTIME_OPTIONS,
  executeDeterministicTurnAttempt,
  isRetryableSchedulerError,
  pickTurnMessageType,
  resolveSchedulerRuntimeOptions,
  SchedulerTurnError,
} from "./run-scheduler";

const EMPTY_CONVERSATION_CONTEXT = {
  globalRecent: [],
  channelRecent: [],
  involvementRecent: [],
} as const;

function createCandidate(
  overrides: Partial<CompiledTurnCandidate> = {},
): CompiledTurnCandidate {
  return {
    id: "candidate-1",
    channelId: "channel-1",
    stepOrder: null,
    sourceAgentId: "agent-a",
    sourceAgentName: "Avery Exec",
    sourceAgentObjective: "Approve the final decision.",
    targetAgentId: "agent-b",
    targetAgentName: "Quinn QA",
    targetAgentObjective: "Challenge weak assumptions.",
    priority: 120,
    allowedMessageTypes: ["proposal", "critique", "decision"],
    mountItemIds: ["vault-1"],
    mountItemCount: 1,
    ...overrides,
  };
}

describe("run-scheduler", () => {
  it("normalizes scheduler runtime options from state and overrides", () => {
    const runtime = resolveSchedulerRuntimeOptions(
      {
        schedulerRuntime: {
          maxRetries: 9,
          turnTimeoutMs: 40,
          transientFailureSequences: [1, 1, 3, -2],
        },
      },
      {
        timeoutFailureSequences: [2, 2, 4],
      },
    );

    expect(runtime.maxRetries).toBe(5);
    expect(runtime.turnTimeoutMs).toBe(500);
    expect(runtime.transientFailureSequences).toEqual([1, 3]);
    expect(runtime.timeoutFailureSequences).toEqual([2, 4]);
  });

  it("picks decision for last queued turn when allowed", () => {
    expect(
      pickTurnMessageType(["proposal", "decision"], false),
    ).toBe("proposal");
    expect(
      pickTurnMessageType(["proposal", "decision"], true),
    ).toBe("decision");
  });

  it("recovers from a transient turn error on retry", async () => {
    const candidate = createCandidate();
    const runtime = resolveSchedulerRuntimeOptions(undefined, {
      ...DEFAULT_SCHEDULER_RUNTIME_OPTIONS,
      transientFailureSequences: [2],
    });

    await expect(
      executeDeterministicTurnAttempt({
        runId: "run-1",
        runObjective: "Test objective",
        sequence: 2,
        attempt: 1,
        candidate,
        conversationContext: EMPTY_CONVERSATION_CONTEXT,
        role: "manager",
        thinkingProfile: "standard",
        isLastQueuedTurn: false,
        runtimeOptions: runtime,
      }),
    ).rejects.toBeInstanceOf(SchedulerTurnError);

    const secondAttempt = await executeDeterministicTurnAttempt({
      runId: "run-1",
      runObjective: "Test objective",
      sequence: 2,
      attempt: 2,
      candidate,
      conversationContext: EMPTY_CONVERSATION_CONTEXT,
      role: "manager",
      thinkingProfile: "standard",
      isLastQueuedTurn: false,
      runtimeOptions: runtime,
    });

    expect(secondAttempt.messageType).toBe("proposal");
    expect(secondAttempt.summary.length).toBeGreaterThan(0);
    expect(secondAttempt.model.length).toBeGreaterThan(0);
  });

  it("marks timeout failures as retryable", async () => {
    const candidate = createCandidate();
    const runtime = resolveSchedulerRuntimeOptions(undefined, {
      ...DEFAULT_SCHEDULER_RUNTIME_OPTIONS,
      turnTimeoutMs: 200,
      timeoutFailureSequences: [1],
    });

    try {
      await executeDeterministicTurnAttempt({
        runId: "run-1",
        runObjective: "Test objective",
        sequence: 1,
        attempt: 1,
        candidate,
        conversationContext: EMPTY_CONVERSATION_CONTEXT,
        role: "manager",
        thinkingProfile: "standard",
        isLastQueuedTurn: false,
        runtimeOptions: runtime,
      });
      expect.fail("Expected timeout error.");
    } catch (error) {
      expect(isRetryableSchedulerError(error)).toBe(true);
    }
  });
});
