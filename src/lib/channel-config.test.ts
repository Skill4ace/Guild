import { ChannelVisibility } from "@prisma/client";
import type { Edge } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import {
  assertChannelWriteAllowed,
  canAgentReadFromChannel,
  canAgentWriteToChannel,
  fromPrismaChannelVisibility,
  syncWorkspaceChannelsFromBoard,
  toCompilerChannelConfig,
  toPrismaChannelVisibility,
} from "./channel-config";
import type { ChannelEdgeData } from "./board-state";

describe("channel-config", () => {
  it("maps visibility values between board and Prisma", () => {
    expect(toPrismaChannelVisibility("public")).toBe(ChannelVisibility.PUBLIC);
    expect(toPrismaChannelVisibility("private")).toBe(ChannelVisibility.PRIVATE);
    expect(fromPrismaChannelVisibility(ChannelVisibility.PUBLIC)).toBe("public");
    expect(fromPrismaChannelVisibility(ChannelVisibility.PRIVATE)).toBe("private");
  });

  it("normalizes compiler channel configs", () => {
    const normalized = toCompilerChannelConfig({
      id: "channel-1",
      boardEdgeId: "edge-1",
      workspaceId: "workspace-1",
      name: "Exec to QA",
      sourceAgentId: "agent-a",
      targetAgentId: "agent-b",
      metadata: { stepOrder: 4 },
      visibility: ChannelVisibility.PRIVATE,
      allowedMessageTypes: ["proposal", "unknown", "decision"],
      writerAgentIds: ["agent-a", "agent-a", "agent-b"],
      readerAgentIds: ["agent-a", "agent-c"],
      updatedAt: new Date("2026-02-07T12:00:00.000Z"),
    });

    expect(normalized.allowedMessageTypes).toEqual(["proposal", "decision"]);
    expect(normalized.writerAgentIds).toEqual(["agent-a", "agent-b"]);
    expect(normalized.readerAgentIds).toEqual(["agent-a", "agent-c"]);
    expect(normalized.stepOrder).toBe(4);
    expect(normalized.visibility).toBe("private");
  });

  it("blocks write attempts when message type is not allowed", () => {
    const result = canAgentWriteToChannel(
      {
        sourceAgentId: "agent-a",
        targetAgentId: "agent-b",
        visibility: "public",
        allowedMessageTypes: ["proposal"],
        writerAgentIds: ["agent-a", "agent-b"],
        readerAgentIds: [],
      },
      "agent-a",
      "decision",
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("MESSAGE_TYPE_BLOCKED");
    }
  });

  it("blocks write attempts for unauthorized writers", () => {
    const result = canAgentWriteToChannel(
      {
        sourceAgentId: "agent-a",
        targetAgentId: "agent-b",
        visibility: "public",
        allowedMessageTypes: ["proposal", "decision"],
        writerAgentIds: ["agent-a"],
        readerAgentIds: [],
      },
      "agent-c",
      "proposal",
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("WRITER_BLOCKED");
    }
  });

  it("enforces read policy for private channels", () => {
    const blocked = canAgentReadFromChannel(
      {
        sourceAgentId: "agent-a",
        targetAgentId: "agent-b",
        visibility: "private",
        allowedMessageTypes: ["proposal"],
        writerAgentIds: ["agent-a", "agent-b"],
        readerAgentIds: ["agent-a"],
      },
      "agent-c",
    );

    const allowed = canAgentReadFromChannel(
      {
        sourceAgentId: "agent-a",
        targetAgentId: "agent-b",
        visibility: "private",
        allowedMessageTypes: ["proposal"],
        writerAgentIds: ["agent-a", "agent-b"],
        readerAgentIds: ["agent-a"],
      },
      "agent-a",
    );

    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it("throws when assert write guard fails", () => {
    expect(() =>
      assertChannelWriteAllowed(
        {
          sourceAgentId: "agent-a",
          targetAgentId: "agent-b",
          visibility: "public",
          allowedMessageTypes: ["proposal"],
          writerAgentIds: ["agent-a"],
          readerAgentIds: [],
        },
        "agent-c",
        "proposal",
      ),
    ).toThrow("WRITER_BLOCKED");
  });

  it("syncs channel ACL from board edges", async () => {
    const upsert = vi.fn(async () => undefined);
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const db = {
      agent: {
        findMany: vi.fn(async () => [
          { id: "agent-a", boardNodeId: "node-a", name: "Agent A" },
          { id: "agent-b", boardNodeId: "node-b", name: "Agent B" },
          { id: "agent-c", boardNodeId: "node-c", name: "Agent C" },
        ]),
      },
      channel: {
        upsert,
        deleteMany,
      },
    };

    const edges: Array<Edge<ChannelEdgeData>> = [
      {
        id: "edge-1",
        source: "node-a",
        target: "node-b",
        data: {
          stepOrder: 3,
          visibility: "private",
          messageTypes: ["proposal", "critique", "vote_call", "decision"],
          writerNodeIds: ["node-a", "node-b"],
          readerNodeIds: ["node-a", "node-c"],
        },
      },
    ];

    await syncWorkspaceChannelsFromBoard(
      db as never,
      "workspace-1",
      edges,
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    const firstCall = upsert.mock.calls[0][0];
    expect(firstCall.create.workspaceId).toBe("workspace-1");
    expect(firstCall.create.boardEdgeId).toBe("edge-1");
    expect(firstCall.create.visibility).toBe(ChannelVisibility.PRIVATE);
    expect(firstCall.create.writerAgentIds).toEqual(["agent-a", "agent-b"]);
    expect(firstCall.create.readerAgentIds).toEqual(["agent-a", "agent-c"]);
    expect(firstCall.create.metadata).toEqual({ stepOrder: 3 });
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });
});
