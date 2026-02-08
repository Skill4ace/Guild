import { describe, expect, it } from "vitest";

import { evaluateDeadlockMediation } from "./deadlock-mediation";

describe("deadlock-mediation", () => {
  it("detects repeated objections and summarizes", () => {
    const result = evaluateDeadlockMediation({
      history: [
        { sequence: 1, messageType: "proposal" },
        { sequence: 2, messageType: "critique" },
      ],
      currentMessageType: "critique",
      queuedTurnsRemaining: 2,
      failureCode: null,
      retriesExhausted: false,
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

    expect(result.deadlocked).toBe(true);
    expect(result.status).toBe("monitoring");
    expect(result.action).toBe("summarize");
    expect(result.signals).toContain("repeated_objections");
  });

  it("requests evidence when critique streak grows", () => {
    const result = evaluateDeadlockMediation({
      history: [
        { sequence: 1, messageType: "critique" },
        { sequence: 2, messageType: "critique" },
      ],
      currentMessageType: "critique",
      queuedTurnsRemaining: 1,
      failureCode: null,
      retriesExhausted: false,
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

    expect(result.critiqueStreak).toBe(3);
    expect(result.action).toBe("request_evidence");
    expect(result.terminateRun).toBe(false);
  });

  it("forces vote when no majority remains at end of queue", () => {
    const result = evaluateDeadlockMediation({
      history: [{ sequence: 1, messageType: "proposal" }],
      currentMessageType: "decision",
      queuedTurnsRemaining: 0,
      failureCode: null,
      retriesExhausted: false,
      vote: {
        voteId: "vote-1",
        status: "OPEN",
        outcome: "no_consensus",
        winner: null,
        quorumReached: true,
        thresholdReached: false,
        tie: true,
      },
    });

    expect(result.status).toBe("resolved");
    expect(result.action).toBe("force_vote");
    expect(result.resolveRun).toBe(true);
    expect(result.forceVote).toBe(true);
    expect(result.signals).toContain("no_majority");
  });

  it("terminates run when timeout retries are exhausted", () => {
    const result = evaluateDeadlockMediation({
      history: [{ sequence: 1, messageType: "proposal" }],
      currentMessageType: null,
      queuedTurnsRemaining: 1,
      failureCode: "TURN_TIMEOUT",
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

    expect(result.status).toBe("terminated");
    expect(result.action).toBe("summarize");
    expect(result.terminateRun).toBe(true);
    expect(result.signals).toContain("timeout_exhaustion");
  });
});
