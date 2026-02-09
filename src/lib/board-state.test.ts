import { describe, expect, it } from "vitest";

import {
  createEmptyBoardDocument,
  sanitizeBoardDocument,
  withEdgeLabel,
} from "./board-state";

describe("board-state", () => {
  it("returns a safe empty document for invalid inputs", () => {
    const board = sanitizeBoardDocument(null);

    expect(board.objective).toBe(
      "Define the main mission and decision criteria for this run.",
    );
    expect(board.nodes).toEqual([]);
    expect(board.edges).toEqual([]);
    expect(board.viewport).toEqual({ x: 0, y: 0, zoom: 1.05 });
  });

  it("keeps only valid nodes and edges", () => {
    const board = sanitizeBoardDocument({
      nodes: [
        {
          id: "a1",
          position: { x: 10, y: 20 },
          data: { label: "Planner", role: "executor", objective: "plan" },
        },
        { id: "bad-node" },
      ],
      edges: [
        {
          id: "e1",
          source: "a1",
          target: "a1",
          sourceHandle: "source-right",
          targetHandle: "target-left",
          data: {
            stepOrder: 2,
            visibility: "private",
            messageTypes: ["proposal"],
            writerNodeIds: ["a1", "missing"],
          },
        },
        {
          id: "e2",
          source: "missing",
          target: "a1",
        },
      ],
      viewport: { x: 1, y: 2, zoom: 1.2 },
    });

    expect(board.objective).toBe(
      "Define the main mission and decision criteria for this run.",
    );
    expect(board.nodes).toHaveLength(1);
    expect(board.nodes[0].type).toBe("agent");
    expect(board.nodes[0].data.role).toBe("operator");
    expect(board.nodes[0].data.authorityWeight).toBe(1);
    expect(board.nodes[0].data.thinkingProfile).toBe("fast");
    expect(board.nodes[0].data.privateMemoryEnabled).toBe(false);
    expect(board.nodes[0].data.tools).toEqual({
      googleSearchEnabled: false,
      codeExecutionEnabled: false,
      imageGenerationEnabled: false,
    });
    expect(board.edges).toHaveLength(1);
    expect(board.edges[0].label).toBe("step 2 | private | proposal");
    expect(board.edges[0].data?.stepOrder).toBe(2);
    expect(board.edges[0].sourceHandle).toBe("source-right");
    expect(board.edges[0].targetHandle).toBe("target-left");
    expect(board.edges[0].data?.writerNodeIds).toEqual(["a1"]);
    expect(board.edges[0].data?.readerNodeIds).toEqual(["a1"]);
    expect(board.viewport).toEqual({ x: 1, y: 2, zoom: 1.2 });
  });

  it("keeps a top-level objective when provided", () => {
    const board = sanitizeBoardDocument({
      objective: "Debate whether we should approve the launch this quarter.",
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1.05 },
    });

    expect(board.objective).toBe(
      "Debate whether we should approve the launch this quarter.",
    );
  });

  it("adds labels to edges consistently", () => {
    const edge = withEdgeLabel({
      id: "e3",
      source: "a1",
      target: "a2",
      data: {
        stepOrder: null,
        visibility: "public",
        messageTypes: ["proposal", "critique"],
        writerNodeIds: ["a1"],
        readerNodeIds: [],
      },
    });

    expect(edge.label).toBe("auto | public | proposal, critique");
    expect(edge.data?.writerNodeIds).toEqual(["a1"]);
  });

  it("creates empty board document", () => {
    const board = createEmptyBoardDocument();

    expect(board.version).toBe(1);
    expect(board.objective).toBe(
      "Define the main mission and decision criteria for this run.",
    );
    expect(board.nodes).toHaveLength(0);
    expect(board.edges).toHaveLength(0);
  });
});
