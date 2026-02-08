import { describe, expect, it } from "vitest";

import { buildForkRunName, resolveForkCheckpoint } from "./run-fork";

describe("run-fork", () => {
  it("resolves latest checkpoint when request is null", () => {
    const resolved = resolveForkCheckpoint({
      turns: [
        { id: "t1", sequence: 1 },
        { id: "t2", sequence: 2 },
        { id: "t3", sequence: 3 },
      ],
      requestedSequence: null,
    });

    expect(resolved.maxSequence).toBe(3);
    expect(resolved.checkpointSequence).toBe(3);
    expect(resolved.checkpointTurnId).toBe("t3");
  });

  it("clamps checkpoint to valid sequence range", () => {
    const resolved = resolveForkCheckpoint({
      turns: [
        { id: "t2", sequence: 2 },
        { id: "t4", sequence: 4 },
      ],
      requestedSequence: 99,
    });

    expect(resolved.maxSequence).toBe(4);
    expect(resolved.checkpointSequence).toBe(4);
    expect(resolved.checkpointTurnId).toBe("t4");
  });

  it("maps checkpoint to nearest preceding existing turn", () => {
    const resolved = resolveForkCheckpoint({
      turns: [
        { id: "t2", sequence: 2 },
        { id: "t4", sequence: 4 },
      ],
      requestedSequence: 3,
    });

    expect(resolved.checkpointSequence).toBe(3);
    expect(resolved.checkpointTurnId).toBe("t2");
  });

  it("builds fallback fork name when explicit is empty", () => {
    expect(
      buildForkRunName({
        explicitName: "   ",
        sourceRunName: "Org Demo",
        checkpointSequence: 6,
      }),
    ).toBe("Org Demo Fork T6");
  });

  it("prefers explicit fork name", () => {
    expect(
      buildForkRunName({
        explicitName: "My Clean Fork",
        sourceRunName: "Org Demo",
        checkpointSequence: 6,
      }),
    ).toBe("My Clean Fork");
  });
});
