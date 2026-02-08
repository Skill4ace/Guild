import { describe, expect, it, vi } from "vitest";

import type { RuntimeChannelPolicy } from "./channel-config";
import {
  buildDefaultToolCallsForTurn,
  executeToolGatewayBatch,
  type ToolGatewayDbClient,
} from "./tool-gateway";

const defaultChannelPolicy: RuntimeChannelPolicy = {
  sourceAgentId: "agent-a",
  targetAgentId: "agent-b",
  visibility: "private",
  allowedMessageTypes: ["proposal", "critique", "vote_call", "decision"],
  writerAgentIds: ["agent-a"],
  readerAgentIds: ["agent-a", "agent-b"],
};

describe("tool-gateway", () => {
  it("builds default tools with vote and decision hooks", () => {
    const voteCallTools = buildDefaultToolCallsForTurn({
      channelId: "channel-1",
      sequence: 4,
      messageType: "vote_call",
      summary: "Call a vote on option readiness.",
      confidence: 0.72,
      payload: {
        question: "Ship this plan?",
        options: ["ship", "revise", "reject"],
        quorum: 2,
      },
      mountItemIds: ["vault-1"],
    });

    expect(voteCallTools.map((tool) => tool.tool)).toEqual([
      "post_message",
      "fetch_mount",
      "request_vote",
      "checkpoint_state",
    ]);

    const decisionTools = buildDefaultToolCallsForTurn({
      channelId: "channel-1",
      sequence: 5,
      messageType: "decision",
      summary: "Approved with minor edits.",
      confidence: 0.88,
      payload: {
        decision: "Approve",
      },
      mountItemIds: [],
    });

    expect(decisionTools.map((tool) => tool.tool)).toEqual([
      "post_message",
      "checkpoint_state",
      "set_status",
    ]);
  });

  it("executes request_vote and fetch_mount when policy allows", async () => {
    const voteCreate = vi.fn(async () => ({ id: "vote-1", question: "Ship?" }));
    const db = {
      vote: {
        create: voteCreate,
      },
    } as unknown as ToolGatewayDbClient;

    const result = await executeToolGatewayBatch({
      db,
      workspaceId: "workspace-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 1,
      actorAgentId: "agent-a",
      actorRole: "manager",
      channelId: "channel-1",
      channelPolicy: defaultChannelPolicy,
      mountedItems: [
        {
          vaultItemId: "vault-1",
          name: "Rules",
          fileName: "rules.md",
          mimeType: "text/markdown",
          byteSize: 140,
          storageKey: "workspace/rules.md",
          tags: ["rules"],
          mountedByScopes: ["RUN"],
          mountedByIds: ["mount-1"],
        },
      ],
      toolCalls: [
        {
          schema: "guild.tool_call.v1",
          tool: "request_vote",
          arguments: {
            question: "Ship?",
            options: ["yes", "no"],
            quorum: 2,
          },
        },
        {
          schema: "guild.tool_call.v1",
          tool: "fetch_mount",
          arguments: {
            vaultItemId: "vault-1",
          },
        },
      ],
    });

    expect(voteCreate).toHaveBeenCalledTimes(1);
    expect(result.summary).toEqual({
      requested: 2,
      executed: 2,
      blocked: 0,
      invalid: 0,
    });
    expect(result.voteIds).toEqual(["vote-1"]);
  });

  it("blocks status changes for non-executive roles", async () => {
    const db = {
      vote: {
        create: vi.fn(),
      },
    } as unknown as ToolGatewayDbClient;

    const result = await executeToolGatewayBatch({
      db,
      workspaceId: "workspace-1",
      runId: "run-1",
      turnId: "turn-2",
      sequence: 2,
      actorAgentId: "agent-a",
      actorRole: "manager",
      channelId: "channel-1",
      channelPolicy: defaultChannelPolicy,
      mountedItems: [],
      toolCalls: [
        {
          schema: "guild.tool_call.v1",
          tool: "set_status",
          arguments: { status: "COMPLETED" },
        },
      ],
    });

    expect(result.summary).toEqual({
      requested: 1,
      executed: 0,
      blocked: 1,
      invalid: 0,
    });
    expect(result.events[0]?.blockCode).toBe("POLICY_BLOCKED");
  });

  it("marks malformed tool calls as invalid", async () => {
    const db = {
      vote: {
        create: vi.fn(),
      },
    } as unknown as ToolGatewayDbClient;

    const result = await executeToolGatewayBatch({
      db,
      workspaceId: "workspace-1",
      runId: "run-1",
      turnId: "turn-3",
      sequence: 3,
      actorAgentId: "agent-a",
      actorRole: "executive",
      channelId: "channel-1",
      channelPolicy: defaultChannelPolicy,
      mountedItems: [],
      toolCalls: [
        {
          schema: "guild.tool_call.v1",
          tool: "delete_database",
          arguments: {},
        },
      ],
    });

    expect(result.summary).toEqual({
      requested: 1,
      executed: 0,
      blocked: 0,
      invalid: 1,
    });
    expect(result.events[0]?.status).toBe("invalid");
    expect(result.events[0]?.validationIssues.length).toBeGreaterThan(0);
  });
});
