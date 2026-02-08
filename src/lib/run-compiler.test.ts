import { describe, expect, it } from "vitest";

import type { CompilerAgentConfig } from "./agent-config";
import type { CompilerChannelConfig } from "./channel-config";
import { compileRunPlan } from "./run-compiler";

function createAgent(
  overrides: Partial<CompilerAgentConfig> & Pick<CompilerAgentConfig, "id" | "name">,
): CompilerAgentConfig {
  return {
    id: overrides.id,
    workspaceId: "workspace-1",
    boardNodeId: `node-${overrides.id}`,
    name: overrides.name,
    role: "operator",
    roleLabel: "Operator",
    objective: "",
    authorityWeight: 1,
    thinkingProfile: "standard",
    privateMemoryEnabled: false,
    persona: "",
    constraints: [],
    updatedAt: "2026-02-07T13:00:00.000Z",
    ...overrides,
  };
}

function createChannel(
  overrides: Partial<CompilerChannelConfig> &
    Pick<
      CompilerChannelConfig,
      "id" | "name" | "sourceAgentId" | "targetAgentId"
    >,
): CompilerChannelConfig {
  return {
    id: overrides.id,
    boardEdgeId: `edge-${overrides.id}`,
    workspaceId: "workspace-1",
    name: overrides.name,
    sourceAgentId: overrides.sourceAgentId,
    targetAgentId: overrides.targetAgentId,
    stepOrder: null,
    visibility: "public",
    allowedMessageTypes: ["proposal"],
    writerAgentIds: [overrides.sourceAgentId, overrides.targetAgentId],
    readerAgentIds: [],
    updatedAt: "2026-02-07T13:01:00.000Z",
    ...overrides,
  };
}

describe("run-compiler", () => {
  it("fails fast when graph is empty", () => {
    const plan = compileRunPlan({
      workspaceId: "workspace-1",
      runId: null,
      agents: [],
      channels: [],
      mounts: [],
    });

    expect(plan.valid).toBe(false);
    expect(plan.turnCandidates).toEqual([]);
    expect(plan.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["NO_AGENTS", "NO_CHANNELS"]),
    );
  });

  it("returns actionable channel validation issues", () => {
    const plan = compileRunPlan({
      workspaceId: "workspace-1",
      runId: null,
      agents: [
        createAgent({
          id: "agent-1",
          name: "Avery Exec",
          role: "executive",
          roleLabel: "Executive",
          authorityWeight: 5,
        }),
      ],
      channels: [
        createChannel({
          id: "channel-1",
          name: "Broken channel",
          sourceAgentId: "agent-1",
          targetAgentId: "agent-missing",
        }),
      ],
      mounts: [],
    });

    expect(plan.valid).toBe(false);
    expect(plan.turnCandidates).toHaveLength(0);
    expect(
      plan.issues.some((issue) => issue.code === "CHANNEL_TARGET_MISSING"),
    ).toBe(true);
    expect(
      plan.issues.some((issue) => issue.hint.includes("Re-save the board")),
    ).toBe(true);
  });

  it("compiles a prioritized executable plan with mount context and stop conditions", () => {
    const plan = compileRunPlan({
      workspaceId: "workspace-1",
      runId: "run-1",
      agents: [
        createAgent({
          id: "agent-exec",
          name: "Avery Exec",
          role: "executive",
          roleLabel: "Executive",
          objective: "Approve final decision.",
          authorityWeight: 5,
          thinkingProfile: "deep",
        }),
        createAgent({
          id: "agent-qa",
          name: "Quinn QA",
          role: "specialist",
          roleLabel: "Specialist",
          objective: "Challenge weak conclusions.",
          authorityWeight: 3,
        }),
      ],
      channels: [
        createChannel({
          id: "channel-review",
          name: "Review",
          sourceAgentId: "agent-exec",
          targetAgentId: "agent-qa",
          visibility: "public",
          allowedMessageTypes: ["proposal", "decision"],
        }),
        createChannel({
          id: "channel-feedback",
          name: "Feedback",
          sourceAgentId: "agent-qa",
          targetAgentId: "agent-exec",
          visibility: "private",
          allowedMessageTypes: ["critique"],
        }),
      ],
      mounts: [
        {
          id: "mount-run",
          scope: "RUN",
          runId: "run-1",
          agentId: null,
          channelId: null,
          vaultItem: {
            id: "vault-rules",
            name: "Run Rules",
            fileName: "rules.md",
            mimeType: "text/markdown",
            byteSize: 100,
            storageKey: "seed/rules.md",
            tags: ["rules"],
          },
        },
        {
          id: "mount-agent",
          scope: "AGENT",
          runId: null,
          agentId: "agent-exec",
          channelId: null,
          vaultItem: {
            id: "vault-persona",
            name: "Exec Persona",
            fileName: "persona.md",
            mimeType: "text/markdown",
            byteSize: 120,
            storageKey: "seed/persona.md",
            tags: ["examples"],
          },
        },
        {
          id: "mount-channel",
          scope: "CHANNEL",
          runId: null,
          agentId: null,
          channelId: "channel-review",
          vaultItem: {
            id: "vault-channel",
            name: "Review Criteria",
            fileName: "criteria.md",
            mimeType: "text/markdown",
            byteSize: 140,
            storageKey: "seed/criteria.md",
            tags: ["rules"],
          },
        },
      ],
    });

    expect(plan.valid).toBe(true);
    expect(plan.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(plan.turnCandidates).toHaveLength(2);
    expect(plan.turnCandidates[0]?.channelId).toBe("channel-review");
    expect(plan.turnCandidates[0]?.sourceAgentObjective).toBe(
      "Approve final decision.",
    );
    expect(plan.turnCandidates[0]?.targetAgentObjective).toBe(
      "Challenge weak conclusions.",
    );
    expect(plan.turnCandidates[0]?.mountItemCount).toBe(3);
    expect(plan.stopConditions.map((condition) => condition.kind)).toEqual([
      "decision_message",
      "max_turns",
      "no_progress_rounds",
    ]);
    expect(
      plan.stopConditions.find((condition) => condition.kind === "max_turns")
        ?.value,
    ).toBe(12);
  });

  it("prioritizes lower explicit step order before auto-priority scoring", () => {
    const plan = compileRunPlan({
      workspaceId: "workspace-1",
      runId: "run-2",
      agents: [
        createAgent({
          id: "agent-exec",
          name: "Avery Exec",
          role: "executive",
          roleLabel: "Executive",
          authorityWeight: 5,
        }),
        createAgent({
          id: "agent-mgr",
          name: "Morgan Manager",
          role: "manager",
          roleLabel: "Manager",
          authorityWeight: 2,
        }),
        createAgent({
          id: "agent-op",
          name: "Otis Operator",
          role: "operator",
          roleLabel: "Operator",
          authorityWeight: 1,
        }),
      ],
      channels: [
        createChannel({
          id: "channel-high-priority",
          name: "High Priority",
          sourceAgentId: "agent-exec",
          targetAgentId: "agent-mgr",
          stepOrder: 3,
          allowedMessageTypes: ["proposal"],
        }),
        createChannel({
          id: "channel-lower-priority",
          name: "Lower Priority",
          sourceAgentId: "agent-mgr",
          targetAgentId: "agent-op",
          stepOrder: 1,
          allowedMessageTypes: ["proposal"],
        }),
      ],
      mounts: [],
    });

    expect(plan.valid).toBe(true);
    expect(plan.turnCandidates[0]?.channelId).toBe("channel-lower-priority");
    expect(plan.turnCandidates[1]?.channelId).toBe("channel-high-priority");
    expect(plan.turnCandidates[0]?.stepOrder).toBe(1);
  });
});
