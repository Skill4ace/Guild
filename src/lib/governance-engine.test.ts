import { describe, expect, it } from "vitest";

import {
  evaluateGovernanceForTurn,
  normalizeGovernancePolicies,
  type GovernanceActorProfile,
  type GovernanceTurnRecord,
} from "./governance-engine";

function actorProfiles(): Map<string, GovernanceActorProfile> {
  return new Map([
    [
      "agent-exec",
      {
        agentId: "agent-exec",
        role: "executive",
        authorityWeight: 5,
      },
    ],
    [
      "agent-qa",
      {
        agentId: "agent-qa",
        role: "specialist",
        authorityWeight: 3,
      },
    ],
    [
      "agent-dir",
      {
        agentId: "agent-dir",
        role: "director",
        authorityWeight: 4,
      },
    ],
  ]);
}

describe("governance-engine", () => {
  it("normalizes approval policy DSL from JSON config", () => {
    const policies = normalizeGovernancePolicies([
      {
        id: "policy-1",
        name: "QA Approval Gate",
        kind: "APPROVAL",
        scope: "RUN",
        channelId: null,
        runId: "run-1",
        config: {
          requiredRoles: ["SPECIALIST"],
          minApprovalWeight: 3,
          approvalMessageTypes: ["proposal", "decision"],
        },
      },
    ]);

    expect(policies).toHaveLength(1);
    expect(policies[0]?.kind).toBe("APPROVAL");
    if (!policies[0] || policies[0].kind !== "APPROVAL") {
      throw new Error("Expected approval policy.");
    }
    expect(policies[0].requiredRoles).toEqual(["specialist"]);
    expect(policies[0].minApprovalWeight).toBe(3);
  });

  it("blocks decision when required approval role is missing", () => {
    const policies = normalizeGovernancePolicies([
      {
        id: "policy-approval",
        name: "Require QA",
        kind: "APPROVAL",
        scope: "RUN",
        channelId: null,
        runId: "run-1",
        config: {
          requiredRoles: ["SPECIALIST"],
          decisionOnly: true,
        },
      },
    ]);
    const history: GovernanceTurnRecord[] = [
      {
        turnId: "turn-1",
        sequence: 1,
        actorAgentId: "agent-exec",
        channelId: "channel-1",
        messageType: "proposal",
      },
    ];

    const evaluation = evaluateGovernanceForTurn({
      policies,
      history,
      current: {
        turnId: "turn-2",
        sequence: 2,
        actorAgentId: "agent-exec",
        channelId: "channel-1",
        messageType: "decision",
      },
      actorProfilesById: actorProfiles(),
      blockedTurns: 0,
    });

    expect(evaluation.status).toBe("blocked");
    expect(evaluation.reasons.join(" ")).toContain("missing required roles");
  });

  it("allows decision once specialist approval exists", () => {
    const policies = normalizeGovernancePolicies([
      {
        id: "policy-approval",
        name: "Require QA",
        kind: "APPROVAL",
        scope: "RUN",
        channelId: null,
        runId: "run-1",
        config: {
          requiredRoles: ["SPECIALIST"],
          decisionOnly: true,
        },
      },
    ]);
    const history: GovernanceTurnRecord[] = [
      {
        turnId: "turn-1",
        sequence: 1,
        actorAgentId: "agent-qa",
        channelId: "channel-1",
        messageType: "proposal",
      },
    ];

    const evaluation = evaluateGovernanceForTurn({
      policies,
      history,
      current: {
        turnId: "turn-2",
        sequence: 2,
        actorAgentId: "agent-exec",
        channelId: "channel-1",
        messageType: "decision",
      },
      actorProfilesById: actorProfiles(),
      blockedTurns: 0,
    });

    expect(evaluation.status).toBe("allowed");
    expect(evaluation.approval.missingRoles).toEqual([]);
  });

  it("triggers veto and escalation thresholds", () => {
    const policies = normalizeGovernancePolicies([
      {
        id: "policy-veto",
        name: "Director Veto",
        kind: "VETO",
        scope: "RUN",
        channelId: null,
        runId: "run-1",
        config: {
          vetoRoles: ["DIRECTOR"],
          minVetoWeight: 4,
        },
      },
      {
        id: "policy-escalation",
        name: "Escalate after block",
        kind: "ESCALATION",
        scope: "RUN",
        channelId: null,
        runId: "run-1",
        config: {
          blockedTurnThreshold: 1,
          note: "Escalate to executive review.",
        },
      },
    ]);
    const history: GovernanceTurnRecord[] = [
      {
        turnId: "turn-1",
        sequence: 1,
        actorAgentId: "agent-dir",
        channelId: "channel-1",
        messageType: "critique",
      },
    ];

    const evaluation = evaluateGovernanceForTurn({
      policies,
      history,
      current: {
        turnId: "turn-2",
        sequence: 2,
        actorAgentId: "agent-exec",
        channelId: "channel-1",
        messageType: "decision",
      },
      actorProfilesById: actorProfiles(),
      blockedTurns: 1,
    });

    expect(evaluation.status).toBe("blocked");
    expect(evaluation.veto.triggered).toBe(true);
    expect(evaluation.escalation.triggered).toBe(true);
    expect(evaluation.escalation.note).toContain("Escalate");
  });
});
