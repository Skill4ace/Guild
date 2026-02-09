import { selectGeminiModel } from "./gemini-client";
import {
  createDefaultAgentNodeData,
  sanitizeBoardDocument,
  withEdgeLabel,
  type AgentRole,
  type BoardDocument,
  type ChannelMessageType,
} from "./board-state";
import {
  getTemplateDefinition,
  isTemplateKey,
  type TemplateKey,
} from "./template-library";

const MAX_INTENT_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_OBJECTIVE_LENGTH = 400;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const HUB_SPOKE_MIN_WORKERS = 2;
const HUB_SPOKE_MAX_WORKERS = 8;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export type AutoWorkspaceDraft = {
  templateKey: TemplateKey;
  boardObjective: string;
  runMission: string;
  workspaceDescription: string | null;
  topology: AutoWorkspaceTopology;
  boardDocument: BoardDocument | null;
  source: "local" | "gemini";
};

export type AutoWorkspaceTopology =
  | {
      kind: "template";
    }
  | {
      kind: "hub_spoke";
      leadLabel: string;
      workerPrefix: string;
      workerCount: number;
    };

export type AutoWorkspaceDraftTelemetry = {
  source: "local" | "gemini-live" | "gemini-fallback";
  model: string | null;
  statusCode: number | null;
  reason: string | null;
};

export type GenerateAutoWorkspaceDraftResult = {
  draft: AutoWorkspaceDraft;
  telemetry: AutoWorkspaceDraftTelemetry;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function ensureSentence(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) {
    return normalized;
  }

  const tail = normalized[normalized.length - 1];
  if (tail === "." || tail === "!" || tail === "?") {
    return normalized;
  }

  return `${normalized}.`;
}

function clampText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return value.slice(0, limit).trimEnd();
}

function normalizeDescription(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = normalizeWhitespace(value);
  if (trimmed.length === 0) {
    return null;
  }

  return clampText(trimmed, MAX_DESCRIPTION_LENGTH);
}

function normalizeObjective(value: string): string {
  const sentence = ensureSentence(value);
  const clamped = clampText(sentence, MAX_OBJECTIVE_LENGTH);
  return clamped.length > 0
    ? clamped
    : "Set a clear mission, route work across agents, and reach a governed decision.";
}

function tokenCount(value: string): number {
  return normalizeWhitespace(value).split(" ").filter(Boolean).length;
}

function parsePrimaryText(payload: GeminiGenerateContentResponse): string {
  const candidate = payload.candidates?.[0];
  const part = candidate?.content?.parts?.find(
    (entry) => typeof entry.text === "string" && entry.text.trim().length > 0,
  );
  return part?.text?.trim() ?? "";
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function cleanJsonText(value: string): string {
  return value.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeWord(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "").trim();
}

function titleCaseToken(value: string): string {
  if (!value) {
    return value;
  }

  return `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function isHubSpokeIntent(intent: string): boolean {
  const normalized = intent.toLowerCase();
  const hubSignals = [
    "mediator",
    "coordinator",
    "orchestrator",
    "lead agent",
    "hub",
    "director",
    "manager",
  ];
  const workerSignals = [
    "worker",
    "workers",
    "agent",
    "agents",
    "team",
    "specialist",
    "specialists",
  ];
  const relationSignals = [
    "connect",
    "connected",
    "connection",
    "link",
    "linked",
    "links",
    "route",
    "routes",
    "delegate",
    "delegates",
    "multiple",
    "many",
    "several",
    "bunch",
  ];

  return (
    hubSignals.some((signal) => normalized.includes(signal)) &&
    workerSignals.some((signal) => normalized.includes(signal)) &&
    relationSignals.some((signal) => normalized.includes(signal))
  );
}

function inferHubLeadLabel(intent: string): string {
  const normalized = intent.toLowerCase();
  const namedRoleMatch = intent.match(
    /\b(?:mediator|lead(?:er)?|coordinator|orchestrator|director|manager)\s+named\s+([a-z][a-z0-9_-]{1,24})/i,
  );
  const genericNamedMatch = intent.match(/\bnamed\s+([a-z][a-z0-9_-]{1,24})/i);
  const rawName = normalizeWord(namedRoleMatch?.[1] ?? genericNamedMatch?.[1] ?? "");

  let suffix = "Lead";
  if (normalized.includes("mediator")) {
    suffix = "Mediator";
  } else if (normalized.includes("director")) {
    suffix = "Director";
  } else if (normalized.includes("coordinator") || normalized.includes("orchestrator")) {
    suffix = "Coordinator";
  } else if (normalized.includes("manager")) {
    suffix = "Manager";
  }

  if (rawName.length === 0) {
    return suffix === "Lead" ? "Lead Agent" : suffix;
  }

  return `${titleCaseToken(rawName)} ${suffix}`;
}

function inferHubWorkerPrefix(intent: string): string {
  const match = intent.match(/\b([a-z0-9_-]{2,16})\s+workers?\b/i);
  const token = normalizeWord(match?.[1] ?? "");
  const blocked = new Set(["multiple", "several", "many", "bunch", "all", "other"]);

  if (token.length === 0 || blocked.has(token.toLowerCase())) {
    return "Worker";
  }

  if (/^[a-z]{2,4}$/i.test(token) && token === token.toUpperCase()) {
    return `${token} Worker`;
  }

  if (/^[a-z]{2,4}$/i.test(token)) {
    return `${token.toUpperCase()} Worker`;
  }

  return `${titleCaseToken(token)} Worker`;
}

function parseCountWord(value: string): number | null {
  const mapping: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  return mapping[value.toLowerCase()] ?? null;
}

function inferHubWorkerCount(intent: string): number {
  const explicitNumberMatch = intent.match(
    /\b(\d{1,2})\s+(?:workers?|agents?|specialists?|contributors?)\b/i,
  );
  if (explicitNumberMatch) {
    return clampInteger(
      Number(explicitNumberMatch[1]),
      HUB_SPOKE_MIN_WORKERS,
      HUB_SPOKE_MAX_WORKERS,
    );
  }

  const explicitWordMatch = intent.match(
    /\b(one|two|three|four|five|six|seven|eight)\s+(?:workers?|agents?|specialists?|contributors?)\b/i,
  );
  if (explicitWordMatch) {
    return clampInteger(
      parseCountWord(explicitWordMatch[1]) ?? 3,
      HUB_SPOKE_MIN_WORKERS,
      HUB_SPOKE_MAX_WORKERS,
    );
  }

  const normalized = intent.toLowerCase();
  if (
    normalized.includes("multiple") ||
    normalized.includes("several") ||
    normalized.includes("many") ||
    normalized.includes("bunch")
  ) {
    return 4;
  }

  return 3;
}

function inferLeadRole(intent: string): AgentRole {
  const normalized = intent.toLowerCase();
  if (normalized.includes("executive") || normalized.includes("ceo")) {
    return "executive";
  }
  if (
    normalized.includes("mediator") ||
    normalized.includes("director") ||
    normalized.includes("coordinator") ||
    normalized.includes("orchestrator")
  ) {
    return "director";
  }
  if (normalized.includes("manager")) {
    return "manager";
  }
  return "director";
}

function inferAutoTopology(intent: string | null): AutoWorkspaceTopology {
  if (!intent) {
    return { kind: "template" };
  }

  if (!isHubSpokeIntent(intent)) {
    return { kind: "template" };
  }

  return {
    kind: "hub_spoke",
    leadLabel: inferHubLeadLabel(intent),
    workerPrefix: inferHubWorkerPrefix(intent),
    workerCount: inferHubWorkerCount(intent),
  };
}

function buildHubSpokeBoardDocument(input: {
  objective: string;
  intent: string;
  topology: Extract<AutoWorkspaceTopology, { kind: "hub_spoke" }>;
}): BoardDocument {
  const leadRole = inferLeadRole(input.intent);
  const leadData = createDefaultAgentNodeData(leadRole, input.topology.leadLabel);
  leadData.objective =
    "Coordinate worker outputs, enforce quality constraints, and publish the final direction.";
  leadData.persona =
    "System coordinator that routes work, resolves conflicts, and keeps the mission on track.";
  leadData.constraints = [
    "Synthesize worker outputs before final guidance",
    "Request clarification when evidence is weak",
  ];
  leadData.privateMemoryEnabled = true;

  const nodeGap = 220;
  const totalSpan = (input.topology.workerCount - 1) * nodeGap;
  const firstWorkerX = 360 - totalSpan / 2;
  const workers = Array.from({ length: input.topology.workerCount }).map((_, index) => {
    const workerData = createDefaultAgentNodeData(
      "specialist",
      `${input.topology.workerPrefix} ${index + 1}`,
    );
    workerData.objective =
      "Produce one scoped contribution for the mission, then respond to coordinator feedback.";
    workerData.persona = "Execution contributor focused on clear, evidence-backed outputs.";
    workerData.constraints = [
      "Stay scoped to assigned sub-task",
      "Return actionable output",
    ];
    return {
      id: `auto-worker-${index + 1}`,
      type: "agent",
      position: {
        x: firstWorkerX + index * nodeGap,
        y: 340,
      },
      data: workerData,
    };
  });

  const leadNode = {
    id: "auto-lead",
    type: "agent",
    position: {
      x: 360,
      y: 90,
    },
    data: leadData,
  };

  const edges = workers.flatMap((worker, index) => {
    const inbound = withEdgeLabel({
      id: `auto-e-in-${index + 1}`,
      source: worker.id,
      target: leadNode.id,
      sourceHandle: "source-top",
      targetHandle: "target-bottom",
      type: "smoothstep",
      data: {
        stepOrder: index + 1,
        visibility: "private",
        messageTypes: ["proposal", "critique"] as ChannelMessageType[],
        writerNodeIds: [worker.id, leadNode.id],
        readerNodeIds: [worker.id, leadNode.id],
      },
    });

    const outbound = withEdgeLabel({
      id: `auto-e-out-${index + 1}`,
      source: leadNode.id,
      target: worker.id,
      sourceHandle: "source-bottom",
      targetHandle: "target-top",
      type: "smoothstep",
      data: {
        stepOrder: input.topology.workerCount + index + 1,
        visibility: "public",
        messageTypes: ["proposal", "critique", "vote_call"] as ChannelMessageType[],
        writerNodeIds: [leadNode.id, worker.id],
        readerNodeIds: [],
      },
    });

    return [inbound, outbound];
  });

  const finalDecisionEdge = withEdgeLabel({
    id: "auto-e-final",
    source: leadNode.id,
    target: workers[0]?.id ?? leadNode.id,
    sourceHandle: "source-right",
    targetHandle: "target-left",
    type: "smoothstep",
    data: {
      stepOrder: input.topology.workerCount * 2 + 1,
      visibility: "public",
      messageTypes: ["decision"] as ChannelMessageType[],
      writerNodeIds: [leadNode.id],
      readerNodeIds: [],
    },
  });

  return sanitizeBoardDocument({
    version: 1,
    objective: input.objective,
    nodes: [leadNode, ...workers],
    edges: [...edges, finalDecisionEdge],
    viewport: {
      x: 0,
      y: 0,
      zoom: 0.85,
      objective: input.objective,
    },
  });
}

function inferTemplateByKeywords(intent: string): TemplateKey {
  const normalized = intent.toLowerCase();

  if (isHubSpokeIntent(intent)) {
    return "build";
  }

  const gameSignals = [
    "poker",
    "dealer",
    "player",
    "referee",
    "game",
    "simulation",
    "round",
  ];
  if (gameSignals.some((keyword) => normalized.includes(keyword))) {
    return "game";
  }

  const debateSignals = [
    "debate",
    "argue",
    "argument",
    "compare",
    "comparison",
    "versus",
    "vs",
    "decide whether",
    "whether",
    "which is better",
    "better overall",
    "pros and cons",
    "for and against",
    "side a",
    "side b",
    "side vs side",
    "mediator",
    "verdict",
  ];
  if (debateSignals.some((keyword) => normalized.includes(keyword))) {
    return "debate";
  }

  const orgSignals = [
    "roadmap",
    "incident",
    "company",
    "team",
    "org",
    "workflow",
    "plan",
    "launch",
    "ship",
    "priority",
    "department",
  ];
  if (orgSignals.some((keyword) => normalized.includes(keyword))) {
    return "org";
  }

  return "build";
}

export function normalizeWorkspaceIntent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = normalizeWhitespace(value);
  if (trimmed.length === 0) {
    return null;
  }

  return clampText(trimmed, MAX_INTENT_LENGTH);
}

export function shouldUseGeminiWorkspaceRefinement(
  intent: string | null,
): boolean {
  if (!intent) {
    return false;
  }

  if (isHubSpokeIntent(intent)) {
    return true;
  }

  const lowered = intent.toLowerCase();
  const words = tokenCount(intent);

  if (intent.length >= 100 || words >= 18) {
    return true;
  }

  const complexitySignals = [
    "including",
    "constraints",
    "tradeoff",
    "multi-step",
    "kpi",
    "governance",
    "evidence",
    "across",
    "plus",
    "and then",
  ];

  return complexitySignals.some((signal) => lowered.includes(signal));
}

export function buildLocalAutoWorkspaceDraft(input: {
  intent: string | null;
  workspaceDescription: string | null;
}): AutoWorkspaceDraft {
  const topology = inferAutoTopology(input.intent);
  const templateKey =
    topology.kind === "hub_spoke"
      ? "build"
      : input.intent
        ? inferTemplateByKeywords(input.intent)
        : "build";
  const template = getTemplateDefinition(templateKey);
  const mission = input.intent
    ? normalizeObjective(input.intent)
    : normalizeObjective(template.objective);
  const fallbackDescription = normalizeDescription(
    input.workspaceDescription ??
      (input.intent ? `Auto setup for: ${input.intent}` : template.tagLine),
  );

  const boardDocument =
    topology.kind === "hub_spoke" && input.intent
      ? buildHubSpokeBoardDocument({
          objective: mission,
          intent: input.intent,
          topology,
        })
      : null;

  return {
    templateKey,
    boardObjective: mission,
    runMission: mission,
    workspaceDescription: fallbackDescription,
    topology,
    boardDocument,
    source: "local",
  };
}

function resolveAutoIntentSeed(input: {
  intent: string | null;
  workspaceDescription: string | null;
}): string | null {
  if (input.intent && input.intent.length > 0) {
    return input.intent;
  }

  return normalizeWorkspaceIntent(input.workspaceDescription);
}

function buildGeminiWorkspacePrompt(input: {
  workspaceName: string;
  intent: string;
  localDraft: AutoWorkspaceDraft;
  existingDescription: string | null;
}): string {
  return [
    "You create initial workspace setups for Guild, a multi-agent orchestration app.",
    "Choose either a template setup or a custom hub-and-spoke setup.",
    "Allowed templateKey values: debate, org, game, build.",
    "Topology kinds: template, hub_spoke.",
    `Workspace name: ${input.workspaceName}`,
    `User goal: ${input.intent}`,
    `Current description: ${input.existingDescription ?? "(none)"}`,
    `Local fallback template: ${input.localDraft.templateKey}`,
    `Local fallback topology: ${input.localDraft.topology.kind}`,
    `Local fallback mission: ${input.localDraft.boardObjective}`,
    "Return JSON only:",
    JSON.stringify(
      {
        templateKey: "debate|org|game|build",
        boardObjective: "string",
        runMission: "string",
        workspaceDescription: "string",
        topology: {
          kind: "template|hub_spoke",
          leadLabel: "string (hub_spoke only)",
          workerPrefix: "string (hub_spoke only)",
          workerCount: "number 2-8 (hub_spoke only)",
        },
      },
      null,
      2,
    ),
    "Rules:",
    "- Keep boardObjective and runMission specific and actionable.",
    "- Keep workspaceDescription to one short sentence.",
    "- Use topology.kind=hub_spoke when the user asks for one lead/mediator connected to multiple workers.",
    "- If topology.kind is hub_spoke, set templateKey to build.",
    "- No markdown fences.",
  ].join("\n");
}

function sanitizeGeminiTopology(
  candidate: unknown,
  fallback: AutoWorkspaceTopology,
  intent: string | null,
): AutoWorkspaceTopology {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fallback;
  }

  const payload = candidate as Record<string, unknown>;
  const rawKind = typeof payload.kind === "string" ? payload.kind.trim().toLowerCase() : "";

  if (rawKind !== "hub_spoke") {
    if (fallback.kind === "hub_spoke") {
      return fallback;
    }

    return { kind: "template" };
  }

  const localHubFallback =
    fallback.kind === "hub_spoke"
      ? fallback
      : inferAutoTopology(intent && intent.length > 0 ? intent : null);
  const base =
    localHubFallback.kind === "hub_spoke"
      ? localHubFallback
      : {
          kind: "hub_spoke" as const,
          leadLabel: "Lead Agent",
          workerPrefix: "Worker",
          workerCount: 3,
        };

  const leadLabel =
    typeof payload.leadLabel === "string"
      ? clampText(normalizeWhitespace(payload.leadLabel), 60)
      : base.leadLabel;
  const workerPrefix =
    typeof payload.workerPrefix === "string"
      ? clampText(normalizeWhitespace(payload.workerPrefix), 40)
      : base.workerPrefix;
  const workerCountRaw =
    typeof payload.workerCount === "number" && Number.isFinite(payload.workerCount)
      ? payload.workerCount
      : base.workerCount;

  return {
    kind: "hub_spoke",
    leadLabel: leadLabel.length > 0 ? leadLabel : base.leadLabel,
    workerPrefix: workerPrefix.length > 0 ? workerPrefix : base.workerPrefix,
    workerCount: clampInteger(
      workerCountRaw,
      HUB_SPOKE_MIN_WORKERS,
      HUB_SPOKE_MAX_WORKERS,
    ),
  };
}

function sanitizeGeminiDraft(
  candidate: unknown,
  fallback: AutoWorkspaceDraft,
  intent: string | null,
): AutoWorkspaceDraft {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fallback;
  }

  const payload = candidate as Record<string, unknown>;
  const boardObjective =
    typeof payload.boardObjective === "string"
      ? normalizeObjective(payload.boardObjective)
      : fallback.boardObjective;
  const runMission =
    typeof payload.runMission === "string"
      ? normalizeObjective(payload.runMission)
      : boardObjective;
  const workspaceDescription =
    typeof payload.workspaceDescription === "string"
      ? normalizeDescription(payload.workspaceDescription)
      : fallback.workspaceDescription;
  const topology = sanitizeGeminiTopology(payload.topology, fallback.topology, intent);

  const templateKey =
    topology.kind === "hub_spoke"
      ? "build"
      : isTemplateKey(payload.templateKey)
        ? payload.templateKey
        : fallback.templateKey;
  const boardDocument =
    topology.kind === "hub_spoke" && intent
      ? buildHubSpokeBoardDocument({
          objective: boardObjective,
          intent,
          topology,
        })
      : fallback.topology.kind === "hub_spoke"
        ? fallback.boardDocument
        : null;

  return {
    templateKey,
    boardObjective,
    runMission,
    workspaceDescription,
    topology,
    boardDocument,
    source: "gemini",
  };
}

async function requestGeminiWorkspaceDraft(input: {
  apiKey: string;
  model: string;
  thinkingLevel: string;
  prompt: string;
}): Promise<{ statusCode: number; body: string; parsed: GeminiGenerateContentResponse }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }],
          },
        ],
        generationConfig: {
          temperature: 1.0,
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: input.thinkingLevel,
          },
        },
      }),
    },
  );

  const body = await response.text();
  const parsed = safeJsonParse(body);
  return {
    statusCode: response.status,
    body,
    parsed:
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as GeminiGenerateContentResponse)
        : {},
  };
}

export async function generateAutoWorkspaceDraft(input: {
  workspaceName: string;
  workspaceDescription: string | null;
  intent: string | null;
  apiKey?: string | null;
}): Promise<GenerateAutoWorkspaceDraftResult> {
  const intentSeed = resolveAutoIntentSeed({
    intent: input.intent,
    workspaceDescription: input.workspaceDescription,
  });
  const localDraft = buildLocalAutoWorkspaceDraft({
    intent: intentSeed,
    workspaceDescription: input.workspaceDescription,
  });
  const normalizedApiKey = (input.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();

  if (!intentSeed || !shouldUseGeminiWorkspaceRefinement(intentSeed)) {
    return {
      draft: localDraft,
      telemetry: {
        source: "local",
        model: null,
        statusCode: null,
        reason: "goal-not-complex",
      },
    };
  }

  if (!normalizedApiKey) {
    return {
      draft: localDraft,
      telemetry: {
        source: "local",
        model: null,
        statusCode: null,
        reason: "no-api-key",
      },
    };
  }

  const modelSelection = selectGeminiModel({
    role: "director",
    thinkingProfile: "deep",
  });
  const prompt = buildGeminiWorkspacePrompt({
    workspaceName: input.workspaceName,
    intent: intentSeed,
    localDraft,
    existingDescription: input.workspaceDescription,
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await requestGeminiWorkspaceDraft({
        apiKey: normalizedApiKey,
        model: modelSelection.model,
        thinkingLevel: modelSelection.thinkingLevel,
        prompt,
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        const text = cleanJsonText(parsePrimaryText(response.parsed) || response.body);
        const parsed = safeJsonParse(text);
        const draft = sanitizeGeminiDraft(parsed, localDraft, intentSeed);
        return {
          draft,
          telemetry: {
            source: "gemini-live",
            model: modelSelection.model,
            statusCode: response.statusCode,
            reason: draft.source === "gemini" ? null : "invalid-json",
          },
        };
      }

      if (!RETRYABLE_STATUS_CODES.has(response.statusCode) || attempt === 2) {
        return {
          draft: localDraft,
          telemetry: {
            source: "gemini-fallback",
            model: modelSelection.model,
            statusCode: response.statusCode,
            reason: "non-ok-response",
          },
        };
      }
    } catch (error) {
      if (attempt === 2) {
        return {
          draft: localDraft,
          telemetry: {
            source: "gemini-fallback",
            model: modelSelection.model,
            statusCode: null,
            reason: error instanceof Error ? error.message.slice(0, 120) : "request-failed",
          },
        };
      }
    }
  }

  return {
    draft: localDraft,
    telemetry: {
      source: "gemini-fallback",
      model: modelSelection.model,
      statusCode: null,
      reason: "retry-exhausted",
    },
  };
}
