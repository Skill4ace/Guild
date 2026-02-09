import type { Edge, Node, Viewport } from "@xyflow/react";

export type AgentRole =
  | "executive"
  | "director"
  | "manager"
  | "specialist"
  | "operator";

export type AgentThinkingProfile = "fast" | "standard" | "deep";

export type AgentToolingConfig = {
  googleSearchEnabled: boolean;
  codeExecutionEnabled: boolean;
  imageGenerationEnabled: boolean;
};

export const CHANNEL_MESSAGE_TYPE_ORDER = [
  "proposal",
  "critique",
  "vote_call",
  "decision",
] as const;

export type ChannelMessageType = (typeof CHANNEL_MESSAGE_TYPE_ORDER)[number];

export const AGENT_ROLE_ORDER: AgentRole[] = [
  "executive",
  "director",
  "manager",
  "specialist",
  "operator",
];

export const AGENT_THINKING_PROFILE_ORDER: AgentThinkingProfile[] = [
  "fast",
  "standard",
  "deep",
];

export const AGENT_TOOLING_META = {
  googleSearchEnabled: {
    label: "Google Search",
    summary: "Allow grounded web search during this agent turn.",
  },
  codeExecutionEnabled: {
    label: "Code Execution",
    summary: "Allow Python code execution for calculations and analysis.",
  },
  imageGenerationEnabled: {
    label: "Image Output",
    summary: "Generate an image artifact from this agent turn.",
  },
} as const;

export const DEFAULT_AGENT_TOOLING: AgentToolingConfig = {
  googleSearchEnabled: false,
  codeExecutionEnabled: false,
  imageGenerationEnabled: false,
};

export const AGENT_THINKING_PROFILE_META: Record<
  AgentThinkingProfile,
  { label: string; summary: string }
> = {
  fast: {
    label: "Fast",
    summary: "Prioritizes speed and low-latency responses.",
  },
  standard: {
    label: "Standard",
    summary: "Balanced depth and response speed.",
  },
  deep: {
    label: "Deep",
    summary: "Uses more deliberation for high-stakes reasoning.",
  },
};

export const CHANNEL_MESSAGE_TYPE_META: Record<
  ChannelMessageType,
  { label: string; summary: string }
> = {
  proposal: {
    label: "Proposal",
    summary: "Suggests a plan or action for the channel to evaluate.",
  },
  critique: {
    label: "Critique",
    summary: "Challenges assumptions, gaps, and risks in a proposal.",
  },
  vote_call: {
    label: "Vote call",
    summary: "Requests a formal vote on options or a recommendation.",
  },
  decision: {
    label: "Decision",
    summary: "Records the final approved direction or outcome.",
  },
};

export const AGENT_ROLE_META: Record<
  AgentRole,
  {
    label: string;
    summary: string;
    level: number;
    defaultAuthorityWeight: number;
    defaultThinkingProfile: AgentThinkingProfile;
    defaultPrivateMemoryEnabled: boolean;
  }
> = {
  executive: {
    label: "Tier 1 - Executive",
    summary: "Sets final direction and approves outcomes.",
    level: 1,
    defaultAuthorityWeight: 5,
    defaultThinkingProfile: "deep",
    defaultPrivateMemoryEnabled: true,
  },
  director: {
    label: "Tier 2 - Director",
    summary: "Translates strategy into coordinated plans.",
    level: 2,
    defaultAuthorityWeight: 4,
    defaultThinkingProfile: "deep",
    defaultPrivateMemoryEnabled: true,
  },
  manager: {
    label: "Tier 3 - Manager",
    summary: "Owns execution scope and dependency routing.",
    level: 3,
    defaultAuthorityWeight: 3,
    defaultThinkingProfile: "standard",
    defaultPrivateMemoryEnabled: false,
  },
  specialist: {
    label: "Tier 4 - Specialist",
    summary: "Performs deep analysis and domain checks.",
    level: 4,
    defaultAuthorityWeight: 2,
    defaultThinkingProfile: "standard",
    defaultPrivateMemoryEnabled: false,
  },
  operator: {
    label: "Tier 5 - Operator",
    summary: "Handles routine tasks and implementation steps.",
    level: 5,
    defaultAuthorityWeight: 1,
    defaultThinkingProfile: "fast",
    defaultPrivateMemoryEnabled: false,
  },
};

export type AgentNodeData = {
  label: string;
  role: AgentRole;
  objective: string;
  persona: string;
  constraints: string[];
  authorityWeight: number;
  thinkingProfile: AgentThinkingProfile;
  privateMemoryEnabled: boolean;
  tools: AgentToolingConfig;
};

export type ChannelEdgeData = {
  stepOrder: number | null;
  visibility: "public" | "private";
  messageTypes: ChannelMessageType[];
  readerNodeIds: string[];
  writerNodeIds: string[];
};

export type BoardDocument = {
  version: 1;
  objective: string;
  nodes: Array<Node<AgentNodeData>>;
  edges: Array<Edge<ChannelEdgeData>>;
  viewport: Viewport;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1.05 };
export const DEFAULT_BOARD_OBJECTIVE =
  "Define the main mission and decision criteria for this run.";
const MAX_CONSTRAINTS = 12;
const MAX_LABEL_LENGTH = 80;
const MAX_BOARD_OBJECTIVE_LENGTH = 400;
const MAX_OBJECTIVE_LENGTH = 260;
const MAX_PERSONA_LENGTH = 600;
const MAX_CONSTRAINT_LENGTH = 120;
const MAX_EDGE_ACL_NODE_IDS = 40;
const MAX_STEP_ORDER = 999;

function edgeLabel(data: ChannelEdgeData): string {
  const stepLabel = data.stepOrder === null ? "auto" : `step ${data.stepOrder}`;
  return `${stepLabel} | ${data.visibility} | ${data.messageTypes.join(", ")}`;
}

function parseAgentRole(value: unknown): AgentRole {
  if (value === "executive") return value;
  if (value === "director") return value;
  if (value === "manager") return value;
  if (value === "specialist") return value;
  if (value === "operator") return value;

  // Legacy role mapping from early board prototype.
  if (value === "exec") {
    return "executive";
  }
  if (value === "mediator") {
    return "director";
  }
  if (value === "qa") {
    return "specialist";
  }
  if (value === "executor") {
    return "operator";
  }

  return "manager";
}

function parseThinkingProfile(
  value: unknown,
  role: AgentRole,
): AgentThinkingProfile {
  if (value === "fast" || value === "FAST") {
    return "fast";
  }
  if (value === "standard" || value === "STANDARD") {
    return "standard";
  }
  if (value === "deep" || value === "DEEP") {
    return "deep";
  }

  return AGENT_ROLE_META[role].defaultThinkingProfile;
}

function parseAgentTooling(value: unknown): AgentToolingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_AGENT_TOOLING };
  }

  const payload = value as Record<string, unknown>;
  return {
    googleSearchEnabled:
      typeof payload.googleSearchEnabled === "boolean"
        ? payload.googleSearchEnabled
        : false,
    codeExecutionEnabled:
      typeof payload.codeExecutionEnabled === "boolean"
        ? payload.codeExecutionEnabled
        : false,
    imageGenerationEnabled:
      typeof payload.imageGenerationEnabled === "boolean"
        ? payload.imageGenerationEnabled
        : false,
  };
}

function parseVisibility(value: unknown): "public" | "private" {
  if (value === "private") {
    return "private";
  }

  return "public";
}

function parseHandleId(
  value: unknown,
  expectedPrefix: "source" | "target",
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  const valid = new Set([
    `${expectedPrefix}-top`,
    `${expectedPrefix}-right`,
    `${expectedPrefix}-bottom`,
    `${expectedPrefix}-left`,
  ]);

  return valid.has(normalized) ? normalized : undefined;
}

function parseChannelMessageType(value: unknown): ChannelMessageType | null {
  if (value === "proposal") return value;
  if (value === "critique") return value;
  if (value === "vote_call") return value;
  if (value === "decision") return value;
  return null;
}

function parseMessageTypes(value: unknown): ChannelMessageType[] {
  if (!Array.isArray(value)) {
    return ["proposal"];
  }

  const parsed = value
    .map((entry) => parseChannelMessageType(entry))
    .filter((entry): entry is ChannelMessageType => entry !== null)
    .filter((entry, index, collection) => collection.indexOf(entry) === index)
    .slice(0, CHANNEL_MESSAGE_TYPE_ORDER.length);

  return parsed.length > 0 ? parsed : ["proposal"];
}

function parseAclNodeIds(value: unknown, allowedNodeIds: Set<string> | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry, index, collection) => collection.indexOf(entry) === index)
    .filter((entry) => (allowedNodeIds ? allowedNodeIds.has(entry) : true))
    .slice(0, MAX_EDGE_ACL_NODE_IDS);
}

function parseStepOrder(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(1, Math.min(MAX_STEP_ORDER, Math.round(value)));
}

export function parseConstraints(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, MAX_CONSTRAINT_LENGTH))
    .slice(0, MAX_CONSTRAINTS);
}

function sanitizeLabel(value: unknown): string {
  if (typeof value !== "string") {
    return "Agent";
  }

  const normalized = value.trim();
  if (!normalized) {
    return "Agent";
  }

  return normalized.slice(0, MAX_LABEL_LENGTH);
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

export function sanitizeBoardObjective(
  value: unknown,
  fallback = DEFAULT_BOARD_OBJECTIVE,
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().slice(0, MAX_BOARD_OBJECTIVE_LENGTH);
  return trimmed.length > 0 ? trimmed : fallback;
}

function clampAuthorityWeight(value: unknown, role: AgentRole): number {
  const fallback = AGENT_ROLE_META[role].defaultAuthorityWeight;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(10, Math.round(value)));
}

export function createDefaultAgentNodeData(
  role: AgentRole,
  label = "Agent",
): AgentNodeData {
  const meta = AGENT_ROLE_META[role];

  return {
    label: sanitizeLabel(label),
    role,
    objective: meta.summary,
    persona: "",
    constraints: [],
    authorityWeight: meta.defaultAuthorityWeight,
    thinkingProfile: meta.defaultThinkingProfile,
    privateMemoryEnabled: meta.defaultPrivateMemoryEnabled,
    tools: { ...DEFAULT_AGENT_TOOLING },
  };
}

export function sanitizeAgentNodeData(value: unknown): AgentNodeData {
  const data =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const role = parseAgentRole(data.role);
  const defaults = createDefaultAgentNodeData(role, sanitizeLabel(data.label));

  return {
    label: defaults.label,
    role,
    objective: sanitizeText(data.objective, MAX_OBJECTIVE_LENGTH) || defaults.objective,
    persona: sanitizeText(data.persona, MAX_PERSONA_LENGTH),
    constraints: parseConstraints(data.constraints),
    authorityWeight: clampAuthorityWeight(data.authorityWeight, role),
    thinkingProfile: parseThinkingProfile(data.thinkingProfile, role),
    privateMemoryEnabled:
      typeof data.privateMemoryEnabled === "boolean"
        ? data.privateMemoryEnabled
        : defaults.privateMemoryEnabled,
    tools: parseAgentTooling(data.tools),
  };
}

function normalizeNodeIdList(values: string[]): string[] {
  return values.filter((value, index, collection) => collection.indexOf(value) === index);
}

export function createDefaultChannelEdgeData(
  sourceNodeId: string,
  targetNodeId: string,
): ChannelEdgeData {
  const defaultWriters = normalizeNodeIdList(
    [sourceNodeId, targetNodeId].filter((value) => value.length > 0),
  );

  return {
    stepOrder: null,
    visibility: "public",
    messageTypes: ["proposal"],
    readerNodeIds: [],
    writerNodeIds: defaultWriters,
  };
}

export function sanitizeChannelEdgeData(
  value: unknown,
  options: {
    sourceNodeId: string;
    targetNodeId: string;
    allowedNodeIds?: Set<string>;
  },
): ChannelEdgeData {
  const data =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const defaults = createDefaultChannelEdgeData(
    options.sourceNodeId,
    options.targetNodeId,
  );
  const allowedNodeIds = options.allowedNodeIds ?? null;
  const visibility = parseVisibility(data.visibility);
  const writerNodeIds = parseAclNodeIds(data.writerNodeIds, allowedNodeIds);
  const readerNodeIds = parseAclNodeIds(data.readerNodeIds, allowedNodeIds);

  return {
    stepOrder: parseStepOrder(data.stepOrder),
    visibility,
    messageTypes: parseMessageTypes(data.messageTypes),
    writerNodeIds: writerNodeIds.length > 0 ? writerNodeIds : defaults.writerNodeIds,
    readerNodeIds:
      readerNodeIds.length > 0
        ? readerNodeIds
        : visibility === "private"
          ? defaults.writerNodeIds
          : [],
  };
}

export function sanitizeBoardDocument(value: unknown): BoardDocument {
  if (!value || typeof value !== "object") {
    return {
      version: 1,
      objective: DEFAULT_BOARD_OBJECTIVE,
      nodes: [],
      edges: [],
      viewport: DEFAULT_VIEWPORT,
    };
  }

  const input = value as Record<string, unknown>;
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  const rawViewport =
    input.viewport && typeof input.viewport === "object"
      ? (input.viewport as Record<string, unknown>)
      : null;
  const objective = sanitizeBoardObjective(
    input.objective,
    sanitizeBoardObjective(rawViewport?.objective),
  );

  const nodes: Array<Node<AgentNodeData>> = rawNodes
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const node = item as Record<string, unknown>;
      const id = typeof node.id === "string" ? node.id : "";
      const position =
        node.position && typeof node.position === "object"
          ? (node.position as Record<string, unknown>)
          : null;

      if (!id || !position) {
        return null;
      }

      const x = typeof position.x === "number" ? position.x : 0;
      const y = typeof position.y === "number" ? position.y : 0;
      const data = sanitizeAgentNodeData(node.data);

      return {
        id,
        position: { x, y },
        type: "agent",
        data,
      } as Node<AgentNodeData>;
    })
    .filter((item): item is Node<AgentNodeData> => item !== null)
    .slice(0, 120);

  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges: Array<Edge<ChannelEdgeData>> = rawEdges
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const edge = item as Record<string, unknown>;
      const id = typeof edge.id === "string" ? edge.id : "";
      const source = typeof edge.source === "string" ? edge.source : "";
      const target = typeof edge.target === "string" ? edge.target : "";
      const sourceHandle = parseHandleId(edge.sourceHandle, "source");
      const targetHandle = parseHandleId(edge.targetHandle, "target");

      if (!id || !source || !target) {
        return null;
      }

      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        return null;
      }

      const edgeData = sanitizeChannelEdgeData(edge.data, {
        sourceNodeId: source,
        targetNodeId: target,
        allowedNodeIds: nodeIds,
      });

      return {
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: "smoothstep",
        label: edgeLabel(edgeData),
        markerEnd: { type: "arrowclosed" },
        data: edgeData,
      } as Edge<ChannelEdgeData>;
    })
    .filter((item): item is Edge<ChannelEdgeData> => item !== null)
    .slice(0, 240);

  const viewport: Viewport = {
    x:
      rawViewport && typeof rawViewport.x === "number"
        ? rawViewport.x
        : DEFAULT_VIEWPORT.x,
    y:
      rawViewport && typeof rawViewport.y === "number"
        ? rawViewport.y
        : DEFAULT_VIEWPORT.y,
    zoom:
      rawViewport && typeof rawViewport.zoom === "number"
        ? rawViewport.zoom
        : DEFAULT_VIEWPORT.zoom,
  };

  return {
    version: 1,
    objective,
    nodes,
    edges,
    viewport,
  };
}

export function createEmptyBoardDocument(): BoardDocument {
  return {
    version: 1,
    objective: DEFAULT_BOARD_OBJECTIVE,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
  };
}

export function withEdgeLabel(edge: Edge<ChannelEdgeData>): Edge<ChannelEdgeData> {
  const data = sanitizeChannelEdgeData(edge.data, {
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
  });
  const isPrivate = data.visibility === "private";
  const baseStyle = {
    stroke: isPrivate ? "#c2410c" : "#0284c7",
    strokeWidth: 2.2,
    strokeDasharray: isPrivate ? "8 5" : undefined,
  };
  const baseLabelStyle = {
    fill: isPrivate ? "#9a3412" : "#0c4a6e",
    fontWeight: 700,
    fontSize: 11,
  };
  const baseLabelBgStyle = {
    fill: isPrivate ? "#ffedd5" : "#e0f2fe",
    fillOpacity: 1,
    stroke: isPrivate ? "#fdba74" : "#7dd3fc",
    strokeWidth: 1,
    rx: 8,
    ry: 8,
  };

  return {
    ...edge,
    type: "smoothstep",
    label: edgeLabel(data),
    markerEnd: { type: "arrowclosed" },
    style: {
      ...baseStyle,
      ...edge.style,
    },
    labelStyle: {
      ...baseLabelStyle,
      ...edge.labelStyle,
    },
    labelBgStyle: {
      ...baseLabelBgStyle,
      ...edge.labelBgStyle,
    },
    labelBgPadding: [10, 4],
    data,
  };
}
