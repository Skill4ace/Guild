import type { CompilerAgentConfig } from "./agent-config";
import type { CompilerChannelConfig } from "./channel-config";
import { resolveMountContextFromMounts } from "./mount-manager";

export type RunCompilerIssueSeverity = "error" | "warning";

export type RunCompilerIssueCode =
  | "NO_AGENTS"
  | "NO_CHANNELS"
  | "NO_EXECUTIVE_AGENT"
  | "NO_DECISION_CHANNEL"
  | "CHANNEL_SOURCE_MISSING"
  | "CHANNEL_TARGET_MISSING"
  | "CHANNEL_SELF_LOOP"
  | "CHANNEL_MESSAGE_TYPES_EMPTY"
  | "PRIVATE_CHANNEL_NO_READERS"
  | "NO_TURN_CANDIDATES";

export type RunCompilerIssue = {
  code: RunCompilerIssueCode;
  severity: RunCompilerIssueSeverity;
  message: string;
  hint: string;
  channelId?: string;
};

export type CompiledPlanAgentNode = {
  agentId: string;
  name: string;
  role: CompilerAgentConfig["role"];
  authorityWeight: number;
  thinkingProfile: CompilerAgentConfig["thinkingProfile"];
  tools: CompilerAgentConfig["tools"];
  incomingChannelIds: string[];
  outgoingChannelIds: string[];
};

export type CompiledPlanChannel = {
  channelId: string;
  name: string;
  sourceAgentId: string;
  targetAgentId: string;
  stepOrder: number | null;
  visibility: CompilerChannelConfig["visibility"];
  messageTypes: CompilerChannelConfig["allowedMessageTypes"];
};

export type CompiledTurnCandidate = {
  id: string;
  channelId: string;
  stepOrder: number | null;
  sourceAgentId: string;
  sourceAgentName: string;
  sourceAgentObjective: string;
  sourceAgentTools: CompilerAgentConfig["tools"];
  targetAgentId: string;
  targetAgentName: string;
  targetAgentObjective: string;
  priority: number;
  allowedMessageTypes: CompilerChannelConfig["allowedMessageTypes"];
  mountItemIds: string[];
  mountItemCount: number;
};

export type CompiledStopCondition = {
  kind: "decision_message" | "max_turns" | "no_progress_rounds";
  label: string;
  value: number;
  reason: string;
};

export type CompiledRunPlan = {
  version: 1;
  workspaceId: string;
  runId: string | null;
  generatedAt: string;
  valid: boolean;
  issues: RunCompilerIssue[];
  graph: {
    agents: CompiledPlanAgentNode[];
    channels: CompiledPlanChannel[];
  };
  turnCandidates: CompiledTurnCandidate[];
  stopConditions: CompiledStopCondition[];
};

export type RunCompilerInput = {
  workspaceId: string;
  runId: string | null;
  agents: CompilerAgentConfig[];
  channels: CompilerChannelConfig[];
  mounts: Array<{
    id: string;
    scope: "AGENT" | "CHANNEL" | "RUN";
    runId: string | null;
    agentId: string | null;
    channelId: string | null;
    vaultItem: {
      id: string;
      name: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      storageKey: string;
      tags: unknown;
    };
  }>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function compareByPriority(a: CompiledTurnCandidate, b: CompiledTurnCandidate): number {
  const aStep = a.stepOrder ?? Number.MAX_SAFE_INTEGER;
  const bStep = b.stepOrder ?? Number.MAX_SAFE_INTEGER;
  if (aStep !== bStep) {
    return aStep - bStep;
  }

  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }

  return a.id.localeCompare(b.id);
}

function buildStopConditions(channelCount: number): CompiledStopCondition[] {
  const maxTurns = clamp(channelCount * 4, 12, 80);
  const noProgressRounds = clamp(Math.ceil(channelCount / 2), 3, 12);

  return [
    {
      kind: "decision_message",
      label: "Decision reached",
      value: 1,
      reason: "Stop when a `decision` message is posted on any channel.",
    },
    {
      kind: "max_turns",
      label: "Turn budget",
      value: maxTurns,
      reason: "Stops runaway execution if no final decision is reached in time.",
    },
    {
      kind: "no_progress_rounds",
      label: "No-progress guard",
      value: noProgressRounds,
      reason: "Stop if repeated rounds pass without new eligible progress.",
    },
  ];
}

export function compileRunPlan(input: RunCompilerInput): CompiledRunPlan {
  const issues: RunCompilerIssue[] = [];
  const graphAgents: CompiledPlanAgentNode[] = input.agents.map((agent) => ({
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    authorityWeight: agent.authorityWeight,
    thinkingProfile: agent.thinkingProfile,
    tools: agent.tools,
    incomingChannelIds: [],
    outgoingChannelIds: [],
  }));
  const agentNodeById = new Map(graphAgents.map((agent) => [agent.agentId, agent]));
  const agentObjectiveById = new Map(
    input.agents.map((agent) => [agent.id, agent.objective]),
  );

  if (graphAgents.length === 0) {
    issues.push({
      code: "NO_AGENTS",
      severity: "error",
      message: "Run compiler found no board agents.",
      hint: "Add at least two agents on Board before starting a run.",
    });
  }

  if (input.channels.length === 0) {
    issues.push({
      code: "NO_CHANNELS",
      severity: "error",
      message: "Run compiler found no channels between agents.",
      hint: "Connect agents with channels on Board so turns can be routed.",
    });
  }

  if (!input.agents.some((agent) => agent.role === "executive")) {
    issues.push({
      code: "NO_EXECUTIVE_AGENT",
      severity: "warning",
      message: "No executive-tier agent found in this graph.",
      hint: "Add a Tier 1 Executive if you want explicit final-approval governance.",
    });
  }

  const graphChannels: CompiledPlanChannel[] = [];
  const turnCandidates: CompiledTurnCandidate[] = [];

  for (const channel of input.channels) {
    const source = agentNodeById.get(channel.sourceAgentId);
    const target = agentNodeById.get(channel.targetAgentId);

    if (!source) {
      issues.push({
        code: "CHANNEL_SOURCE_MISSING",
        severity: "error",
        channelId: channel.id,
        message: `Channel \`${channel.name}\` has no valid source agent.`,
        hint: "Re-save the board so channel endpoints match existing agents.",
      });
      continue;
    }

    if (!target) {
      issues.push({
        code: "CHANNEL_TARGET_MISSING",
        severity: "error",
        channelId: channel.id,
        message: `Channel \`${channel.name}\` has no valid target agent.`,
        hint: "Re-save the board so channel endpoints match existing agents.",
      });
      continue;
    }

    if (source.agentId === target.agentId) {
      issues.push({
        code: "CHANNEL_SELF_LOOP",
        severity: "error",
        channelId: channel.id,
        message: `Channel \`${channel.name}\` creates a self-loop.`,
        hint: "Connect this channel to a different target agent.",
      });
      continue;
    }

    if (channel.allowedMessageTypes.length === 0) {
      issues.push({
        code: "CHANNEL_MESSAGE_TYPES_EMPTY",
        severity: "error",
        channelId: channel.id,
        message: `Channel \`${channel.name}\` has no allowed message schemas.`,
        hint: "Select at least one message type in Channel Inspector.",
      });
      continue;
    }

    if (channel.visibility === "private" && channel.readerAgentIds.length === 0) {
      issues.push({
        code: "PRIVATE_CHANNEL_NO_READERS",
        severity: "warning",
        channelId: channel.id,
        message: `Private channel \`${channel.name}\` has no explicit reader list.`,
        hint: "Set readers explicitly if source/target-only fallback is not intended.",
      });
    }

    source.outgoingChannelIds.push(channel.id);
    target.incomingChannelIds.push(channel.id);

    graphChannels.push({
      channelId: channel.id,
      name: channel.name,
      sourceAgentId: source.agentId,
      targetAgentId: target.agentId,
      stepOrder: channel.stepOrder,
      visibility: channel.visibility,
      messageTypes: channel.allowedMessageTypes,
    });

    const mountContext = resolveMountContextFromMounts(input.mounts, {
      runId: input.runId,
      agentId: source.agentId,
      channelId: channel.id,
    });

    const priority =
      source.authorityWeight * 100 +
      target.authorityWeight * 10 +
      (channel.visibility === "private" ? 5 : 0) +
      (channel.allowedMessageTypes.includes("decision") ? 3 : 0);

    turnCandidates.push({
      id: `candidate-${channel.id}`,
      channelId: channel.id,
      stepOrder: channel.stepOrder,
      sourceAgentId: source.agentId,
      sourceAgentName: source.name,
      sourceAgentObjective: agentObjectiveById.get(source.agentId) ?? "",
      sourceAgentTools: source.tools,
      targetAgentId: target.agentId,
      targetAgentName: target.name,
      targetAgentObjective: agentObjectiveById.get(target.agentId) ?? "",
      priority,
      allowedMessageTypes: channel.allowedMessageTypes,
      mountItemIds: mountContext.items.map((item) => item.vaultItemId),
      mountItemCount: mountContext.items.length,
    });
  }

  const sortedCandidates = turnCandidates.sort(compareByPriority);

  if (graphChannels.length > 0 && sortedCandidates.length === 0) {
    issues.push({
      code: "NO_TURN_CANDIDATES",
      severity: "error",
      message: "No executable turn candidates were produced.",
      hint: "Fix invalid channels and ensure each channel has valid source/target agents.",
    });
  }

  if (
    graphChannels.length > 0 &&
    !graphChannels.some((channel) => channel.messageTypes.includes("decision"))
  ) {
    issues.push({
      code: "NO_DECISION_CHANNEL",
      severity: "warning",
      message: "No channel currently allows `decision` messages.",
      hint: "Allow `decision` on at least one channel so runs can finalize cleanly.",
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");

  return {
    version: 1,
    workspaceId: input.workspaceId,
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    valid: !hasErrors,
    issues,
    graph: {
      agents: graphAgents,
      channels: graphChannels,
    },
    turnCandidates: hasErrors ? [] : sortedCandidates,
    stopConditions: buildStopConditions(graphChannels.length),
  };
}
