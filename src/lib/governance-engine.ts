import type { ChannelMessageType } from "./board-state";
import type { AgentRole as BoardAgentRole } from "./board-state";

type GovernancePolicySource = {
  id: string;
  name: string;
  kind: string;
  scope: string;
  channelId: string | null;
  runId: string | null;
  config: unknown;
};

export type GovernancePolicyKind = "APPROVAL" | "VETO" | "ESCALATION";
export type GovernancePolicyScope = "WORKSPACE" | "RUN" | "CHANNEL";

type GovernancePolicyBase = {
  id: string;
  name: string;
  kind: GovernancePolicyKind;
  scope: GovernancePolicyScope;
  channelId: string | null;
  runId: string | null;
};

export type GovernanceApprovalPolicy = GovernancePolicyBase & {
  kind: "APPROVAL";
  requiredRoles: BoardAgentRole[];
  requiredAgentIds: string[];
  minApprovalWeight: number;
  approvalMessageTypes: ChannelMessageType[];
  decisionOnly: boolean;
};

export type GovernanceVetoPolicy = GovernancePolicyBase & {
  kind: "VETO";
  vetoRoles: BoardAgentRole[];
  vetoAgentIds: string[];
  vetoMessageTypes: ChannelMessageType[];
  blockMessageTypes: ChannelMessageType[];
  minVetoWeight: number;
};

export type GovernanceEscalationPolicy = GovernancePolicyBase & {
  kind: "ESCALATION";
  blockedTurnThreshold: number;
  note: string;
};

export type GovernancePolicy =
  | GovernanceApprovalPolicy
  | GovernanceVetoPolicy
  | GovernanceEscalationPolicy;

export type GovernanceTurnRecord = {
  turnId: string;
  sequence: number;
  actorAgentId: string;
  channelId: string;
  messageType: ChannelMessageType;
};

export type GovernanceActorProfile = {
  agentId: string;
  role: BoardAgentRole;
  authorityWeight: number;
};

export type GovernanceEvaluation = {
  status: "allowed" | "blocked";
  policyCount: number;
  blockingPolicyIds: string[];
  reasons: string[];
  approval: {
    requiredRoles: BoardAgentRole[];
    approvedRoles: BoardAgentRole[];
    requiredAgentIds: string[];
    approvedAgentIds: string[];
    requiredWeight: number;
    approvedWeight: number;
    missingRoles: BoardAgentRole[];
    missingAgentIds: string[];
  };
  veto: {
    triggered: boolean;
    weight: number;
    triggeredByAgentIds: string[];
  };
  escalation: {
    triggered: boolean;
    note: string | null;
  };
};

type EvaluateGovernanceInput = {
  policies: GovernancePolicy[];
  history: GovernanceTurnRecord[];
  current: GovernanceTurnRecord;
  actorProfilesById: Map<string, GovernanceActorProfile>;
  blockedTurns: number;
};

const MESSAGE_TYPES: ChannelMessageType[] = [
  "proposal",
  "critique",
  "vote_call",
  "decision",
];

function asObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(max, Math.round(value)));
}

function toRole(value: unknown): BoardAgentRole | null {
  if (value === "executive" || value === "EXECUTIVE") return "executive";
  if (value === "director" || value === "DIRECTOR") return "director";
  if (value === "manager" || value === "MANAGER") return "manager";
  if (value === "specialist" || value === "SPECIALIST") return "specialist";
  if (value === "operator" || value === "OPERATOR") return "operator";
  return null;
}

function parseRoleList(value: unknown): BoardAgentRole[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toRole(entry))
    .filter((entry): entry is BoardAgentRole => entry !== null)
    .filter((entry, index, collection) => collection.indexOf(entry) === index);
}

function parseAgentIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry, index, collection) => collection.indexOf(entry) === index)
    .slice(0, 80);
}

function parseMessageTypes(
  value: unknown,
  fallback: ChannelMessageType[],
): ChannelMessageType[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const parsed = value
    .filter((entry): entry is ChannelMessageType =>
      typeof entry === "string" &&
      (MESSAGE_TYPES as readonly string[]).includes(entry),
    )
    .filter((entry, index, collection) => collection.indexOf(entry) === index);

  return parsed.length > 0 ? parsed : fallback;
}

function parseScope(value: unknown): GovernancePolicyScope | null {
  if (value === "WORKSPACE") return value;
  if (value === "RUN") return value;
  if (value === "CHANNEL") return value;
  return null;
}

function parseKind(value: unknown): GovernancePolicyKind | null {
  if (value === "APPROVAL") return value;
  if (value === "VETO") return value;
  if (value === "ESCALATION") return value;
  return null;
}

function parseApprovalPolicy(
  source: GovernancePolicySource,
  config: Record<string, unknown>,
): GovernanceApprovalPolicy {
  return {
    id: source.id,
    name: source.name,
    kind: "APPROVAL",
    scope: source.scope as GovernancePolicyScope,
    channelId: source.channelId,
    runId: source.runId,
    requiredRoles: parseRoleList(config.requiredRoles),
    requiredAgentIds: parseAgentIdList(config.requiredAgentIds),
    minApprovalWeight: toPositiveInt(config.minApprovalWeight, 0, 100),
    approvalMessageTypes: parseMessageTypes(config.approvalMessageTypes, [
      "proposal",
      "decision",
    ]),
    decisionOnly: config.decisionOnly !== false,
  };
}

function parseVetoPolicy(
  source: GovernancePolicySource,
  config: Record<string, unknown>,
): GovernanceVetoPolicy {
  return {
    id: source.id,
    name: source.name,
    kind: "VETO",
    scope: source.scope as GovernancePolicyScope,
    channelId: source.channelId,
    runId: source.runId,
    vetoRoles: parseRoleList(config.vetoRoles),
    vetoAgentIds: parseAgentIdList(config.vetoAgentIds),
    vetoMessageTypes: parseMessageTypes(config.vetoMessageTypes, ["critique"]),
    blockMessageTypes: parseMessageTypes(config.blockMessageTypes, ["decision"]),
    minVetoWeight: toPositiveInt(config.minVetoWeight, 1, 100),
  };
}

function parseEscalationPolicy(
  source: GovernancePolicySource,
  config: Record<string, unknown>,
): GovernanceEscalationPolicy {
  const rawNote =
    typeof config.note === "string" ? config.note.trim().slice(0, 240) : "";

  return {
    id: source.id,
    name: source.name,
    kind: "ESCALATION",
    scope: source.scope as GovernancePolicyScope,
    channelId: source.channelId,
    runId: source.runId,
    blockedTurnThreshold: toPositiveInt(config.blockedTurnThreshold, 1, 100),
    note:
      rawNote.length > 0
        ? rawNote
        : "Escalation triggered due to repeated governance blocks.",
  };
}

export function normalizeGovernancePolicies(
  sources: GovernancePolicySource[],
): GovernancePolicy[] {
  const policies: GovernancePolicy[] = [];

  for (const source of sources) {
    const kind = parseKind(source.kind);
    const scope = parseScope(source.scope);
    if (!kind || !scope) {
      continue;
    }

    const normalized: GovernancePolicySource = {
      ...source,
      kind,
      scope,
    };
    const config = asObjectRecord(source.config);

    if (kind === "APPROVAL") {
      policies.push(parseApprovalPolicy(normalized, config));
      continue;
    }

    if (kind === "VETO") {
      policies.push(parseVetoPolicy(normalized, config));
      continue;
    }

    policies.push(parseEscalationPolicy(normalized, config));
  }

  return policies;
}

function roleForActor(
  actorProfilesById: Map<string, GovernanceActorProfile>,
  actorAgentId: string,
): BoardAgentRole | null {
  return actorProfilesById.get(actorAgentId)?.role ?? null;
}

function weightForActor(
  actorProfilesById: Map<string, GovernanceActorProfile>,
  actorAgentId: string,
): number {
  return actorProfilesById.get(actorAgentId)?.authorityWeight ?? 1;
}

function filterPoliciesForCurrentTurn(
  policies: GovernancePolicy[],
  currentChannelId: string | null,
): GovernancePolicy[] {
  return policies.filter((policy) => {
    if (policy.scope !== "CHANNEL") {
      return true;
    }

    return Boolean(policy.channelId && currentChannelId === policy.channelId);
  });
}

export function evaluateGovernanceForTurn(
  input: EvaluateGovernanceInput,
): GovernanceEvaluation {
  const applicablePolicies = filterPoliciesForCurrentTurn(
    input.policies,
    input.current.channelId,
  );
  const events = [...input.history, input.current];
  const blockingPolicyIds: string[] = [];
  const reasons: string[] = [];

  const aggregateRequiredRoles = new Set<BoardAgentRole>();
  const aggregateRequiredAgentIds = new Set<string>();
  const aggregateApprovedRoles = new Set<BoardAgentRole>();
  const aggregateApprovedAgentIds = new Set<string>();
  let maxRequiredWeight = 0;
  let maxApprovedWeight = 0;

  let vetoTriggered = false;
  let vetoWeight = 0;
  const vetoActors = new Set<string>();

  let escalationTriggered = false;
  let escalationNote: string | null = null;

  for (const policy of applicablePolicies) {
    if (policy.kind === "APPROVAL") {
      const shouldEnforce =
        !policy.decisionOnly || input.current.messageType === "decision";
      const approvalEvents = events.filter((event) =>
        policy.approvalMessageTypes.includes(event.messageType),
      );
      const approvedAgentIds = new Set(approvalEvents.map((event) => event.actorAgentId));
      const approvedRoles = new Set<BoardAgentRole>();
      for (const agentId of approvedAgentIds) {
        const role = roleForActor(input.actorProfilesById, agentId);
        if (role) {
          approvedRoles.add(role);
        }
      }

      const missingRoles = policy.requiredRoles.filter(
        (role) => !approvedRoles.has(role),
      );
      const missingAgentIds = policy.requiredAgentIds.filter(
        (agentId) => !approvedAgentIds.has(agentId),
      );
      const approvedWeight = Array.from(approvedAgentIds).reduce(
        (total, agentId) => total + weightForActor(input.actorProfilesById, agentId),
        0,
      );

      for (const role of policy.requiredRoles) {
        aggregateRequiredRoles.add(role);
      }
      for (const agentId of policy.requiredAgentIds) {
        aggregateRequiredAgentIds.add(agentId);
      }
      for (const role of approvedRoles) {
        aggregateApprovedRoles.add(role);
      }
      for (const agentId of approvedAgentIds) {
        aggregateApprovedAgentIds.add(agentId);
      }
      maxRequiredWeight = Math.max(maxRequiredWeight, policy.minApprovalWeight);
      maxApprovedWeight = Math.max(maxApprovedWeight, approvedWeight);

      const weightMissing =
        policy.minApprovalWeight > 0 && approvedWeight < policy.minApprovalWeight;

      if (shouldEnforce && (missingRoles.length > 0 || missingAgentIds.length > 0 || weightMissing)) {
        blockingPolicyIds.push(policy.id);
        const parts: string[] = [];
        if (missingRoles.length > 0) {
          parts.push(`missing required roles: ${missingRoles.join(", ")}`);
        }
        if (missingAgentIds.length > 0) {
          parts.push(`missing required agents: ${missingAgentIds.join(", ")}`);
        }
        if (weightMissing) {
          parts.push(
            `approval weight ${approvedWeight} is below required ${policy.minApprovalWeight}`,
          );
        }
        reasons.push(`${policy.name}: ${parts.join("; ")}.`);
      }

      continue;
    }

    if (policy.kind === "VETO") {
      const enforceForMessage = policy.blockMessageTypes.includes(
        input.current.messageType,
      );
      if (!enforceForMessage) {
        continue;
      }

      const vetoEvents = input.history.filter((event) =>
        policy.vetoMessageTypes.includes(event.messageType),
      );
      const matchingActors = vetoEvents
        .map((event) => event.actorAgentId)
        .filter((agentId, index, collection) => collection.indexOf(agentId) === index)
        .filter((agentId) => {
          const role = roleForActor(input.actorProfilesById, agentId);
          const roleMatch =
            policy.vetoRoles.length === 0 || (role ? policy.vetoRoles.includes(role) : false);
          const agentMatch =
            policy.vetoAgentIds.length === 0 || policy.vetoAgentIds.includes(agentId);
          return roleMatch && agentMatch;
        });

      const totalWeight = matchingActors.reduce(
        (total, agentId) => total + weightForActor(input.actorProfilesById, agentId),
        0,
      );
      if (matchingActors.length > 0 && totalWeight >= policy.minVetoWeight) {
        vetoTriggered = true;
        vetoWeight = Math.max(vetoWeight, totalWeight);
        for (const agentId of matchingActors) {
          vetoActors.add(agentId);
        }
        blockingPolicyIds.push(policy.id);
        reasons.push(
          `${policy.name}: veto triggered by ${matchingActors.length} actor(s), weight ${totalWeight}.`,
        );
      }

      continue;
    }

    if (policy.kind === "ESCALATION") {
      if (input.blockedTurns >= policy.blockedTurnThreshold) {
        escalationTriggered = true;
        escalationNote = policy.note;
      }
    }
  }

  return {
    status: blockingPolicyIds.length > 0 ? "blocked" : "allowed",
    policyCount: applicablePolicies.length,
    blockingPolicyIds,
    reasons,
    approval: {
      requiredRoles: Array.from(aggregateRequiredRoles),
      approvedRoles: Array.from(aggregateApprovedRoles),
      requiredAgentIds: Array.from(aggregateRequiredAgentIds),
      approvedAgentIds: Array.from(aggregateApprovedAgentIds),
      requiredWeight: maxRequiredWeight,
      approvedWeight: maxApprovedWeight,
      missingRoles: Array.from(aggregateRequiredRoles).filter(
        (role) => !aggregateApprovedRoles.has(role),
      ),
      missingAgentIds: Array.from(aggregateRequiredAgentIds).filter(
        (agentId) => !aggregateApprovedAgentIds.has(agentId),
      ),
    },
    veto: {
      triggered: vetoTriggered,
      weight: vetoWeight,
      triggeredByAgentIds: Array.from(vetoActors),
    },
    escalation: {
      triggered: escalationTriggered,
      note: escalationNote,
    },
  };
}
