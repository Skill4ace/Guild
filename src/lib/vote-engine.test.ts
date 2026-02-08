import { describe, expect, it } from "vitest";

import {
  chooseDeterministicVoteOption,
  resolveVoteResult,
} from "./vote-engine";

describe("vote-engine", () => {
  it("resolves weighted winner deterministically", () => {
    const resultA = resolveVoteResult({
      options: ["approve", "revise", "reject"],
      ballots: {
        "agent-c": "approve",
        "agent-a": "approve",
        "agent-b": "revise",
      },
      weights: {
        "agent-a": 5,
        "agent-b": 3,
        "agent-c": 2,
      },
      quorum: 2,
      threshold: 6,
    });

    const resultB = resolveVoteResult({
      options: ["approve", "revise", "reject"],
      ballots: {
        "agent-b": "revise",
        "agent-a": "approve",
        "agent-c": "approve",
      },
      weights: {
        "agent-c": 2,
        "agent-a": 5,
        "agent-b": 3,
      },
      quorum: 2,
      threshold: 6,
    });

    expect(resultA.winner).toBe("approve");
    expect(resultA.outcome).toBe("passed");
    expect(resultA.winner).toBe(resultB.winner);
    expect(resultA.ranking).toEqual(resultB.ranking);
  });

  it("returns no_consensus when quorum is not reached", () => {
    const result = resolveVoteResult({
      options: ["approve", "revise"],
      ballots: {
        "agent-a": "approve",
      },
      weights: {
        "agent-a": 5,
      },
      quorum: 2,
      threshold: null,
    });

    expect(result.quorumReached).toBe(false);
    expect(result.outcome).toBe("no_consensus");
    expect(result.winner).toBe("approve");
  });

  it("breaks ties deterministically by option order", () => {
    const result = resolveVoteResult({
      options: ["approve", "revise"],
      ballots: {
        "agent-a": "approve",
        "agent-b": "revise",
      },
      weights: {
        "agent-a": 3,
        "agent-b": 3,
      },
      quorum: 2,
      threshold: 3,
    });

    expect(result.tie).toBe(true);
    expect(result.winner).toBeNull();
    expect(result.outcome).toBe("no_consensus");
  });

  it("chooses deterministic ballot options from message type", () => {
    const options = ["approve", "revise", "reject"];
    expect(chooseDeterministicVoteOption(options, "proposal")).toBe("approve");
    expect(chooseDeterministicVoteOption(options, "decision")).toBe("approve");
    expect(chooseDeterministicVoteOption(options, "critique")).toBe("revise");
    expect(chooseDeterministicVoteOption(options, "vote_call")).toBe("reject");
  });
});
