import type { Edge, Node } from "@xyflow/react";

import {
  createDefaultAgentNodeData,
  sanitizeBoardDocument,
  withEdgeLabel,
  type AgentRole,
  type BoardDocument,
  type ChannelMessageType,
  type ChannelEdgeData,
} from "./board-state";

export type TemplateKey = "debate" | "org" | "game" | "build";

export type TemplatePolicySeed = {
  name: string;
  kind: "APPROVAL" | "VETO" | "ESCALATION" | "CONSENSUS";
  config: Record<string, unknown>;
};

export type TemplateVoteSeed = {
  question: string;
  quorum: number;
  threshold: number;
  options: string[];
};

export type TemplateDefinition = {
  key: TemplateKey;
  label: string;
  tagLine: string;
  objective: string;
  runTemplate: "DEBATE" | "ORG" | "GAME" | "CUSTOM";
  board: BoardDocument;
  policies: TemplatePolicySeed[];
  initialVote: TemplateVoteSeed | null;
};

export type TemplateManifest = {
  key: TemplateKey;
  label: string;
  tagLine: string;
  objective: string;
  runTemplate: TemplateDefinition["runTemplate"];
  agentCount: number;
  channelCount: number;
  orderedChannelCount: number;
  policyCount: number;
  hasInitialVote: boolean;
};

const TEMPLATE_ORDER: TemplateKey[] = ["debate", "org", "game", "build"];

function createAgentNode(input: {
  id: string;
  label: string;
  role: AgentRole;
  objective: string;
  persona: string;
  constraints: string[];
  authorityWeight?: number;
  thinkingProfile?: "fast" | "standard" | "deep";
  privateMemoryEnabled?: boolean;
  x: number;
  y: number;
}): Node {
  const base = createDefaultAgentNodeData(input.role, input.label);

  return {
    id: input.id,
    type: "agent",
    position: {
      x: input.x,
      y: input.y,
    },
    data: {
      ...base,
      label: input.label,
      objective: input.objective,
      persona: input.persona,
      constraints: input.constraints,
      authorityWeight: input.authorityWeight ?? base.authorityWeight,
      thinkingProfile: input.thinkingProfile ?? base.thinkingProfile,
      privateMemoryEnabled:
        typeof input.privateMemoryEnabled === "boolean"
          ? input.privateMemoryEnabled
          : base.privateMemoryEnabled,
    },
  };
}

function createChannelEdge(input: {
  id: string;
  source: string;
  target: string;
  stepOrder?: number | null;
  visibility: "public" | "private";
  messageTypes: ChannelMessageType[];
  readerNodeIds: string[];
  writerNodeIds: string[];
}): Edge<ChannelEdgeData> {
  const edge: Edge<ChannelEdgeData> = {
    id: input.id,
    source: input.source,
    target: input.target,
    type: "smoothstep",
    data: {
      stepOrder:
        typeof input.stepOrder === "number" && Number.isFinite(input.stepOrder)
          ? Math.max(1, Math.min(999, Math.round(input.stepOrder)))
          : null,
      visibility: input.visibility,
      messageTypes: input.messageTypes,
      readerNodeIds: input.readerNodeIds,
      writerNodeIds: input.writerNodeIds,
    },
  };

  return withEdgeLabel(edge);
}

function buildTemplateBoard(input: {
  nodes: Node[];
  edges: Edge<ChannelEdgeData>[];
  viewport: { x: number; y: number; zoom: number };
}): BoardDocument {
  return sanitizeBoardDocument({
    nodes: input.nodes,
    edges: input.edges,
    viewport: input.viewport,
  });
}

const TEMPLATE_DEFINITIONS: Record<TemplateKey, TemplateDefinition> = {
  debate: {
    key: "debate",
    label: "Debate",
    tagLine: "Two opposing agents argue both sides, then a mediator decides.",
    objective:
      "Given a clear question, run a side-vs-side argument and end with a mediator-issued final decision.",
    runTemplate: "DEBATE",
    board: buildTemplateBoard({
      nodes: [
        createAgentNode({
          id: "debate-side-a",
          label: "Avery Side A",
          role: "manager",
          objective:
            "Argue for the proposition with concrete evidence, assumptions, and expected impact.",
          persona: "Constructive advocate building the strongest affirmative case.",
          constraints: [
            "State assumptions explicitly",
            "Cite concrete evidence in plain language",
          ],
          authorityWeight: 4,
          thinkingProfile: "standard",
          x: 90,
          y: 90,
        }),
        createAgentNode({
          id: "debate-side-b",
          label: "Quinn Side B",
          role: "specialist",
          objective:
            "Argue against the proposition by stress-testing claims, tradeoffs, and failure modes.",
          persona: "Skeptical challenger focused on falsification and risk surfacing.",
          constraints: [
            "Respond directly to Side A claims",
            "Highlight what evidence is missing",
          ],
          authorityWeight: 4,
          thinkingProfile: "deep",
          x: 520,
          y: 90,
        }),
        createAgentNode({
          id: "debate-mediator",
          label: "Morgan Mediator",
          role: "director",
          objective:
            "Synthesize both sides, request clarifications, and issue the final verdict with rationale.",
          persona: "Neutral adjudicator responsible for closure and final decision quality.",
          constraints: [
            "Stay neutral between sides",
            "Issue one explicit final decision",
          ],
          authorityWeight: 4,
          thinkingProfile: "deep",
          privateMemoryEnabled: true,
          x: 300,
          y: 300,
        }),
      ],
      edges: [
        createChannelEdge({
          id: "debate-e1",
          source: "debate-side-a",
          target: "debate-mediator",
          stepOrder: 1,
          visibility: "private",
          messageTypes: ["proposal", "vote_call"],
          writerNodeIds: ["debate-side-a", "debate-mediator"],
          readerNodeIds: ["debate-side-a", "debate-mediator"],
        }),
        createChannelEdge({
          id: "debate-e2",
          source: "debate-side-b",
          target: "debate-mediator",
          stepOrder: 2,
          visibility: "private",
          messageTypes: ["critique", "proposal", "vote_call"],
          writerNodeIds: ["debate-side-b", "debate-mediator"],
          readerNodeIds: ["debate-side-b", "debate-mediator"],
        }),
        createChannelEdge({
          id: "debate-e3",
          source: "debate-side-a",
          target: "debate-side-b",
          stepOrder: 3,
          visibility: "public",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["debate-side-a", "debate-side-b"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "debate-e4",
          source: "debate-side-b",
          target: "debate-side-a",
          stepOrder: 4,
          visibility: "public",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["debate-side-b", "debate-side-a"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "debate-e5",
          source: "debate-mediator",
          target: "debate-side-a",
          stepOrder: 5,
          visibility: "public",
          messageTypes: ["critique", "vote_call"],
          writerNodeIds: ["debate-mediator", "debate-side-a"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "debate-e6",
          source: "debate-mediator",
          target: "debate-side-b",
          stepOrder: 5,
          visibility: "public",
          messageTypes: ["critique", "vote_call"],
          writerNodeIds: ["debate-mediator", "debate-side-b"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "debate-e7",
          source: "debate-mediator",
          target: "debate-side-a",
          stepOrder: 6,
          visibility: "public",
          messageTypes: ["decision"],
          writerNodeIds: ["debate-mediator"],
          readerNodeIds: [],
        }),
      ],
      viewport: { x: 0, y: 0, zoom: 0.92 },
    }),
    policies: [
      {
        name: "Debate Mediator Final Approval",
        kind: "APPROVAL",
        config: {
          requiredRoles: ["director"],
          approvalMessageTypes: ["critique", "vote_call", "decision"],
          minApprovalWeight: 4,
          decisionOnly: true,
        },
      },
      {
        name: "Debate Opposition Veto",
        kind: "VETO",
        config: {
          vetoRoles: ["specialist"],
          vetoMessageTypes: ["critique"],
          blockMessageTypes: ["decision"],
          minVetoWeight: 3,
        },
      },
      {
        name: "Debate Escalation",
        kind: "ESCALATION",
        config: {
          blockedTurnThreshold: 1,
          note: "Escalate unresolved disagreement to mediator-directed closure.",
        },
      },
    ],
    initialVote: {
      question: "Which side presented the stronger case?",
      quorum: 2,
      threshold: 6,
      options: ["side_a", "side_b", "inconclusive"],
    },
  },
  org: {
    key: "org",
    label: "Org",
    tagLine: "Top-down delegation with bottom-up risk escalation and voting.",
    objective:
      "Assign company tasks across tiers, escalate blockers upward, and finalize priorities with governed votes.",
    runTemplate: "ORG",
    board: buildTemplateBoard({
      nodes: [
        createAgentNode({
          id: "org-exec",
          label: "Avery Executive",
          role: "executive",
          objective:
            "Set company objective, decision criteria, and final release priority.",
          persona: "Outcome owner with strict evidence standards.",
          constraints: ["No final decision without escalation review"],
          authorityWeight: 5,
          thinkingProfile: "deep",
          privateMemoryEnabled: true,
          x: 350,
          y: 30,
        }),
        createAgentNode({
          id: "org-director",
          label: "Taylor Director",
          role: "director",
          objective: "Translate strategy into clear workstreams and owners.",
          persona: "Program leader balancing speed and risk.",
          constraints: ["Escalate cross-team dependencies early"],
          authorityWeight: 4,
          thinkingProfile: "deep",
          x: 120,
          y: 170,
        }),
        createAgentNode({
          id: "org-product",
          label: "Jordan Product Lead",
          role: "manager",
          objective:
            "Convert workstreams into scoped initiatives with success metrics.",
          persona: "Product planner focused on scope quality and sequencing.",
          constraints: ["Define acceptance criteria", "Track dependencies and risk"],
          authorityWeight: 3,
          thinkingProfile: "standard",
          x: 350,
          y: 170,
        }),
        createAgentNode({
          id: "org-risk",
          label: "Quinn Risk",
          role: "specialist",
          objective:
            "Audit proposals for compliance, reliability, and rollout risk before approval.",
          persona: "Independent control function with veto authority.",
          constraints: ["Block weak controls", "Require clear rollback strategy"],
          authorityWeight: 3,
          thinkingProfile: "deep",
          x: 580,
          y: 300,
        }),
        createAgentNode({
          id: "org-operator",
          label: "Riley Operator",
          role: "operator",
          objective:
            "Execute assigned initiatives and report delivery blockers quickly.",
          persona: "Delivery-oriented and detail-focused.",
          constraints: ["Report implementation friction quickly"],
          authorityWeight: 2,
          thinkingProfile: "fast",
          x: 350,
          y: 320,
        }),
      ],
      edges: [
        createChannelEdge({
          id: "org-e1",
          source: "org-exec",
          target: "org-director",
          visibility: "public",
          messageTypes: ["proposal", "vote_call", "decision"],
          writerNodeIds: ["org-exec", "org-director"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "org-e2",
          source: "org-director",
          target: "org-product",
          visibility: "public",
          messageTypes: ["proposal", "decision"],
          writerNodeIds: ["org-director", "org-product"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "org-e3",
          source: "org-product",
          target: "org-operator",
          visibility: "public",
          messageTypes: ["proposal", "critique", "vote_call"],
          writerNodeIds: ["org-product", "org-operator"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "org-e4",
          source: "org-operator",
          target: "org-product",
          visibility: "private",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["org-operator", "org-product"],
          readerNodeIds: ["org-operator", "org-product"],
        }),
        createChannelEdge({
          id: "org-e5",
          source: "org-product",
          target: "org-risk",
          visibility: "private",
          messageTypes: ["proposal", "vote_call"],
          writerNodeIds: ["org-product", "org-risk"],
          readerNodeIds: ["org-product", "org-risk"],
        }),
        createChannelEdge({
          id: "org-e6",
          source: "org-risk",
          target: "org-director",
          visibility: "private",
          messageTypes: ["critique", "vote_call"],
          writerNodeIds: ["org-risk", "org-director"],
          readerNodeIds: ["org-risk", "org-director"],
        }),
        createChannelEdge({
          id: "org-e7",
          source: "org-director",
          target: "org-exec",
          visibility: "private",
          messageTypes: ["proposal", "vote_call", "decision"],
          writerNodeIds: ["org-director", "org-exec"],
          readerNodeIds: ["org-director", "org-exec"],
        }),
      ],
      viewport: { x: 0, y: 0, zoom: 0.88 },
    }),
    policies: [
      {
        name: "Org Finalizer Gate",
        kind: "APPROVAL",
        config: {
          requiredRoles: ["executive", "director"],
          approvalMessageTypes: ["proposal", "vote_call", "decision"],
          minApprovalWeight: 8,
          decisionOnly: true,
        },
      },
      {
        name: "Org Risk Veto",
        kind: "VETO",
        config: {
          vetoRoles: ["specialist"],
          vetoMessageTypes: ["critique"],
          blockMessageTypes: ["decision"],
          minVetoWeight: 3,
        },
      },
      {
        name: "Org Escalation",
        kind: "ESCALATION",
        config: {
          blockedTurnThreshold: 1,
          note: "Escalate unresolved org conflicts to executive reprioritization.",
        },
      },
    ],
    initialVote: {
      question: "Which initiative should ship first this cycle?",
      quorum: 3,
      threshold: 8,
      options: ["ship_now", "iterate_first", "defer"],
    },
  },
  game: {
    key: "game",
    label: "Game",
    tagLine: "Dealer/player/referee loop with private state and rule checks.",
    objective:
      "Run one full poker-style round: dealer distributes private state, players return actions, dealer submits the table state, and referee issues the final ruling.",
    runTemplate: "GAME",
    board: buildTemplateBoard({
      nodes: [
        createAgentNode({
          id: "game-dealer",
          label: "Morgan Dealer",
          role: "director",
          objective:
            "Deal private state, collect both player actions, and submit the round summary to the referee.",
          persona: "Neutral table orchestrator controlling turn order.",
          constraints: ["Never leak private player state across channels"],
          authorityWeight: 4,
          thinkingProfile: "deep",
          privateMemoryEnabled: true,
          x: 350,
          y: 40,
        }),
        createAgentNode({
          id: "game-player-a",
          label: "Player A",
          role: "operator",
          objective:
            "Choose the strongest action from private state plus public table context.",
          persona: "Aggressive tactical player.",
          constraints: ["Only act on information visible to this player"],
          authorityWeight: 2,
          thinkingProfile: "fast",
          x: 110,
          y: 220,
        }),
        createAgentNode({
          id: "game-player-b",
          label: "Player B",
          role: "operator",
          objective:
            "Respond to table state with a risk-aware action and counter strategy.",
          persona: "Adaptive tactical player.",
          constraints: ["Only act on information visible to this player"],
          authorityWeight: 2,
          thinkingProfile: "fast",
          x: 600,
          y: 220,
        }),
        createAgentNode({
          id: "game-referee",
          label: "Quinn Referee",
          role: "specialist",
          objective:
            "Validate submitted actions against rules, then issue the final round ruling with rationale.",
          persona: "Strict rules auditor.",
          constraints: ["Reject invalid moves", "Request correction with explicit rule cite"],
          authorityWeight: 3,
          thinkingProfile: "standard",
          x: 350,
          y: 350,
        }),
      ],
      edges: [
        createChannelEdge({
          id: "game-e1",
          source: "game-dealer",
          target: "game-player-a",
          stepOrder: 1,
          visibility: "private",
          messageTypes: ["proposal"],
          writerNodeIds: ["game-dealer", "game-player-a"],
          readerNodeIds: ["game-dealer", "game-player-a"],
        }),
        createChannelEdge({
          id: "game-e2",
          source: "game-dealer",
          target: "game-player-b",
          stepOrder: 1,
          visibility: "private",
          messageTypes: ["proposal"],
          writerNodeIds: ["game-dealer", "game-player-b"],
          readerNodeIds: ["game-dealer", "game-player-b"],
        }),
        createChannelEdge({
          id: "game-e3",
          source: "game-player-a",
          target: "game-dealer",
          stepOrder: 2,
          visibility: "private",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["game-player-a", "game-dealer"],
          readerNodeIds: ["game-player-a", "game-dealer"],
        }),
        createChannelEdge({
          id: "game-e4",
          source: "game-player-b",
          target: "game-dealer",
          stepOrder: 2,
          visibility: "private",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["game-player-b", "game-dealer"],
          readerNodeIds: ["game-player-b", "game-dealer"],
        }),
        createChannelEdge({
          id: "game-e5",
          source: "game-dealer",
          target: "game-referee",
          stepOrder: 4,
          visibility: "public",
          messageTypes: ["proposal", "vote_call"],
          writerNodeIds: ["game-dealer", "game-referee"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "game-e6",
          source: "game-referee",
          target: "game-dealer",
          stepOrder: 5,
          visibility: "public",
          messageTypes: ["critique", "decision"],
          writerNodeIds: ["game-referee", "game-dealer"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "game-e7",
          source: "game-player-a",
          target: "game-player-b",
          stepOrder: 3,
          visibility: "public",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["game-player-a", "game-player-b"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "game-e8",
          source: "game-player-b",
          target: "game-player-a",
          stepOrder: 3,
          visibility: "public",
          messageTypes: ["proposal", "critique"],
          writerNodeIds: ["game-player-b", "game-player-a"],
          readerNodeIds: [],
        }),
      ],
      viewport: { x: 0, y: 0, zoom: 0.9 },
    }),
    policies: [
      {
        name: "Game Referee Gate",
        kind: "APPROVAL",
        config: {
          requiredRoles: ["director", "specialist"],
          approvalMessageTypes: ["proposal", "critique", "decision"],
          minApprovalWeight: 7,
          decisionOnly: true,
        },
      },
      {
        name: "Game Rule Veto",
        kind: "VETO",
        config: {
          vetoRoles: ["specialist"],
          vetoMessageTypes: ["critique"],
          blockMessageTypes: ["decision"],
          minVetoWeight: 3,
        },
      },
      {
        name: "Game Escalation",
        kind: "ESCALATION",
        config: {
          blockedTurnThreshold: 1,
          note: "Escalate stalled game flow to forced arbitration.",
        },
      },
    ],
    initialVote: {
      question: "Select final table outcome.",
      quorum: 2,
      threshold: 6,
      options: ["player_a", "player_b", "draw"],
    },
  },
  build: {
    key: "build",
    label: "Build Your Own",
    tagLine: "Starter scaffold to compose your own governed multi-agent system.",
    objective:
      "Start from a minimal governed scaffold, then customize agents, channels, and policies.",
    runTemplate: "CUSTOM",
    board: buildTemplateBoard({
      nodes: [
        createAgentNode({
          id: "build-lead",
          label: "Lead Architect",
          role: "executive",
          objective: "Define mission and acceptance criteria.",
          persona: "Vision-led system owner.",
          constraints: ["State success metrics clearly"],
          authorityWeight: 5,
          thinkingProfile: "deep",
          privateMemoryEnabled: true,
          x: 140,
          y: 120,
        }),
        createAgentNode({
          id: "build-planner",
          label: "Planner",
          role: "manager",
          objective: "Break mission into executable checkpoints.",
          persona: "Planner focused on sequence and dependencies.",
          constraints: ["Expose assumptions", "Map dependencies"],
          authorityWeight: 3,
          x: 420,
          y: 120,
        }),
        createAgentNode({
          id: "build-operator",
          label: "Operator",
          role: "operator",
          objective: "Implement and report execution status.",
          persona: "Delivery-focused operator.",
          constraints: ["Report blockers instantly"],
          authorityWeight: 2,
          thinkingProfile: "fast",
          x: 420,
          y: 320,
        }),
      ],
      edges: [
        createChannelEdge({
          id: "build-e1",
          source: "build-lead",
          target: "build-planner",
          visibility: "public",
          messageTypes: ["proposal", "vote_call", "decision"],
          writerNodeIds: ["build-lead", "build-planner"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "build-e2",
          source: "build-planner",
          target: "build-operator",
          visibility: "public",
          messageTypes: ["proposal", "decision"],
          writerNodeIds: ["build-planner", "build-operator"],
          readerNodeIds: [],
        }),
        createChannelEdge({
          id: "build-e3",
          source: "build-operator",
          target: "build-lead",
          visibility: "private",
          messageTypes: ["proposal", "critique", "vote_call"],
          writerNodeIds: ["build-operator", "build-lead"],
          readerNodeIds: ["build-operator", "build-lead"],
        }),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    policies: [
      {
        name: "Build Scaffold Escalation",
        kind: "ESCALATION",
        config: {
          blockedTurnThreshold: 2,
          note: "Scaffold escalation: refine your graph or force a vote.",
        },
      },
    ],
    initialVote: {
      question: "Is the custom scaffold ready for first execution?",
      quorum: 2,
      threshold: 6,
      options: ["yes", "revise", "not_yet"],
    },
  },
};

export function listTemplateManifests(): TemplateManifest[] {
  return TEMPLATE_ORDER.map((key) => {
    const template = TEMPLATE_DEFINITIONS[key];
    const orderedChannelCount = template.board.edges.filter((edge) => {
      const stepOrder = edge.data?.stepOrder;
      return typeof stepOrder === "number" && Number.isFinite(stepOrder);
    }).length;

    return {
      key: template.key,
      label: template.label,
      tagLine: template.tagLine,
      objective: template.objective,
      runTemplate: template.runTemplate,
      agentCount: template.board.nodes.length,
      channelCount: template.board.edges.length,
      orderedChannelCount,
      policyCount: template.policies.length,
      hasInitialVote: template.initialVote !== null,
    };
  });
}

export function getTemplateDefinition(key: TemplateKey): TemplateDefinition {
  return TEMPLATE_DEFINITIONS[key];
}

export function isTemplateKey(value: unknown): value is TemplateKey {
  return (
    typeof value === "string" &&
    (TEMPLATE_ORDER as string[]).includes(value)
  );
}
