import type { ChannelMessageType } from "./board-state";

export const AGENT_ACT_SCHEMA_ID = "guild.agent_act.v1";
export const TOOL_CALL_SCHEMA_ID = "guild.tool_call.v1";

export const AGENT_ACT_JSON_SCHEMA = {
  $id: AGENT_ACT_SCHEMA_ID,
  type: "object",
  required: ["schema", "messageType", "summary", "rationale", "confidence", "payload"],
  properties: {
    schema: { const: AGENT_ACT_SCHEMA_ID },
    messageType: { enum: ["proposal", "critique", "vote_call", "decision"] },
    summary: { type: "string", minLength: 1, maxLength: 600 },
    rationale: { type: "string", minLength: 1, maxLength: 1200 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    payload: { type: "object" },
  },
} as const;

export const TOOL_CALL_JSON_SCHEMAS = {
  post_message: {
    $id: `${TOOL_CALL_SCHEMA_ID}.post_message`,
    required: ["channelId", "messageType", "content"],
  },
  request_vote: {
    $id: `${TOOL_CALL_SCHEMA_ID}.request_vote`,
    required: ["question", "options"],
  },
  fetch_mount: {
    $id: `${TOOL_CALL_SCHEMA_ID}.fetch_mount`,
    required: ["vaultItemId"],
  },
  checkpoint_state: {
    $id: `${TOOL_CALL_SCHEMA_ID}.checkpoint_state`,
    required: ["label", "statePatch"],
  },
  set_status: {
    $id: `${TOOL_CALL_SCHEMA_ID}.set_status`,
    required: ["status"],
  },
} as const;

export type StructuredValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type AgentActOutput =
  | {
      schema: typeof AGENT_ACT_SCHEMA_ID;
      messageType: "proposal";
      summary: string;
      rationale: string;
      confidence: number;
      payload: {
        title: string;
        plan: string[];
        risks: string[];
      };
    }
  | {
      schema: typeof AGENT_ACT_SCHEMA_ID;
      messageType: "critique";
      summary: string;
      rationale: string;
      confidence: number;
      payload: {
        issues: string[];
        severity: "low" | "medium" | "high";
        requests: string[];
      };
    }
  | {
      schema: typeof AGENT_ACT_SCHEMA_ID;
      messageType: "vote_call";
      summary: string;
      rationale: string;
      confidence: number;
      payload: {
        question: string;
        options: string[];
        quorum: number;
      };
    }
  | {
      schema: typeof AGENT_ACT_SCHEMA_ID;
      messageType: "decision";
      summary: string;
      rationale: string;
      confidence: number;
      payload: {
        decision: string;
        nextSteps: string[];
      };
    };

export type ToolName =
  | "post_message"
  | "request_vote"
  | "fetch_mount"
  | "checkpoint_state"
  | "set_status";

export type ToolCallOutput = {
  schema: typeof TOOL_CALL_SCHEMA_ID;
  tool: ToolName;
  arguments: Record<string, unknown>;
};

export type ValidationAndRepairResult = {
  output: AgentActOutput;
  status: "valid" | "repaired" | "fallback";
  issues: StructuredValidationIssue[];
  repairSteps: string[];
  parsed: boolean;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.4;
  }

  return Math.max(0, Math.min(1, value));
}

function cleanText(value: unknown, fallback: string, maxLength = 600): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : fallback;
}

function toStringArray(value: unknown, maxItems: number, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const parsed = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);

  return parsed.length > 0 ? parsed : fallback;
}

function addIssue(
  issues: StructuredValidationIssue[],
  path: string,
  code: string,
  message: string,
) {
  issues.push({ path, code, message });
}

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function pickDefaultMessageType(
  allowedMessageTypes: ChannelMessageType[],
  isLastQueuedTurn: boolean,
): ChannelMessageType {
  const allowed: ChannelMessageType[] = allowedMessageTypes.length > 0
    ? allowedMessageTypes
    : ["proposal"];

  if (isLastQueuedTurn && allowed.includes("decision")) {
    return "decision";
  }

  for (const preferred of ["proposal", "critique", "vote_call"] as const) {
    if (allowed.includes(preferred)) {
      return preferred;
    }
  }

  if (allowed.includes("decision")) {
    return "decision";
  }

  return allowed[0] ?? "proposal";
}

function buildFallbackPayload(messageType: ChannelMessageType, summary: string): AgentActOutput["payload"] {
  if (messageType === "proposal") {
    return {
      title: "Proposal",
      plan: [summary],
      risks: [],
    };
  }

  if (messageType === "critique") {
    return {
      issues: [summary],
      severity: "medium",
      requests: [],
    };
  }

  if (messageType === "vote_call") {
    return {
      question: summary,
      options: ["approve", "revise", "reject"],
      quorum: 2,
    };
  }

  return {
    decision: summary,
    nextSteps: [],
  };
}

export function buildFallbackAgentActOutput(input: {
  messageType: ChannelMessageType;
  summary: string;
  rationale: string;
  confidence?: number;
}): AgentActOutput {
  return {
    schema: AGENT_ACT_SCHEMA_ID,
    messageType: input.messageType,
    summary: cleanText(input.summary, "No summary provided."),
    rationale: cleanText(input.rationale, "No rationale provided.", 1200),
    confidence: clampConfidence(input.confidence ?? 0.35),
    payload: buildFallbackPayload(
      input.messageType,
      cleanText(input.summary, "No summary provided."),
    ) as AgentActOutput["payload"],
  } as AgentActOutput;
}

export function validateAgentActOutput(
  value: unknown,
  allowedMessageTypes: ChannelMessageType[],
): { ok: true; value: AgentActOutput } | { ok: false; issues: StructuredValidationIssue[] } {
  const issues: StructuredValidationIssue[] = [];
  if (!isObjectRecord(value)) {
    addIssue(issues, "$", "TYPE", "Output must be an object.");
    return { ok: false, issues };
  }

  const schema = value.schema;
  if (schema !== AGENT_ACT_SCHEMA_ID) {
    addIssue(
      issues,
      "$.schema",
      "SCHEMA",
      `Schema must be ${AGENT_ACT_SCHEMA_ID}.`,
    );
  }

  const messageType = value.messageType;
  if (
    messageType !== "proposal" &&
    messageType !== "critique" &&
    messageType !== "vote_call" &&
    messageType !== "decision"
  ) {
    addIssue(
      issues,
      "$.messageType",
      "ENUM",
      "messageType must be one of proposal|critique|vote_call|decision.",
    );
  } else if (!allowedMessageTypes.includes(messageType)) {
    addIssue(
      issues,
      "$.messageType",
      "ACL",
      "messageType is not allowed by channel policy.",
    );
  }

  const summary = value.summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    addIssue(issues, "$.summary", "STRING", "summary must be non-empty string.");
  } else if (summary.length > 600) {
    addIssue(issues, "$.summary", "MAX_LENGTH", "summary exceeds 600 chars.");
  }

  const rationale = value.rationale;
  if (typeof rationale !== "string" || rationale.trim().length === 0) {
    addIssue(
      issues,
      "$.rationale",
      "STRING",
      "rationale must be non-empty string.",
    );
  } else if (rationale.length > 1200) {
    addIssue(
      issues,
      "$.rationale",
      "MAX_LENGTH",
      "rationale exceeds 1200 chars.",
    );
  }

  const confidence = value.confidence;
  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    addIssue(
      issues,
      "$.confidence",
      "RANGE",
      "confidence must be a number between 0 and 1.",
    );
  }

  const payload = value.payload;
  if (!isObjectRecord(payload)) {
    addIssue(issues, "$.payload", "TYPE", "payload must be an object.");
  } else if (messageType === "proposal") {
    if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
      addIssue(issues, "$.payload.title", "STRING", "proposal payload.title is required.");
    }
    if (!Array.isArray(payload.plan) || payload.plan.length === 0) {
      addIssue(issues, "$.payload.plan", "ARRAY", "proposal payload.plan requires items.");
    }
    if (!Array.isArray(payload.risks)) {
      addIssue(issues, "$.payload.risks", "ARRAY", "proposal payload.risks must be array.");
    }
  } else if (messageType === "critique") {
    if (!Array.isArray(payload.issues) || payload.issues.length === 0) {
      addIssue(issues, "$.payload.issues", "ARRAY", "critique payload.issues requires items.");
    }
    if (
      payload.severity !== "low" &&
      payload.severity !== "medium" &&
      payload.severity !== "high"
    ) {
      addIssue(
        issues,
        "$.payload.severity",
        "ENUM",
        "critique payload.severity must be low|medium|high.",
      );
    }
    if (!Array.isArray(payload.requests)) {
      addIssue(issues, "$.payload.requests", "ARRAY", "critique payload.requests must be array.");
    }
  } else if (messageType === "vote_call") {
    if (typeof payload.question !== "string" || payload.question.trim().length === 0) {
      addIssue(issues, "$.payload.question", "STRING", "vote_call payload.question is required.");
    }
    if (!Array.isArray(payload.options) || payload.options.length < 2) {
      addIssue(
        issues,
        "$.payload.options",
        "ARRAY",
        "vote_call payload.options requires at least two options.",
      );
    }
    if (
      typeof payload.quorum !== "number" ||
      !Number.isInteger(payload.quorum) ||
      payload.quorum < 1
    ) {
      addIssue(
        issues,
        "$.payload.quorum",
        "INTEGER",
        "vote_call payload.quorum must be a positive integer.",
      );
    }
  } else if (messageType === "decision") {
    if (typeof payload.decision !== "string" || payload.decision.trim().length === 0) {
      addIssue(issues, "$.payload.decision", "STRING", "decision payload.decision is required.");
    }
    if (!Array.isArray(payload.nextSteps)) {
      addIssue(
        issues,
        "$.payload.nextSteps",
        "ARRAY",
        "decision payload.nextSteps must be an array.",
      );
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: value as AgentActOutput };
}

function repairCandidateObject(input: {
  parsed: Record<string, unknown>;
  allowedMessageTypes: ChannelMessageType[];
  isLastQueuedTurn: boolean;
  fallbackSummary: string;
}): AgentActOutput {
  const defaultMessageType = pickDefaultMessageType(
    input.allowedMessageTypes,
    input.isLastQueuedTurn,
  );
  const parsedMessageType = input.parsed.messageType;
  const messageType =
    typeof parsedMessageType === "string" &&
      input.allowedMessageTypes.includes(parsedMessageType as ChannelMessageType)
      ? (parsedMessageType as ChannelMessageType)
      : defaultMessageType;

  const summary = cleanText(input.parsed.summary, input.fallbackSummary);
  const rationale = cleanText(
    input.parsed.rationale,
    "Automatically repaired to match Guild schema.",
    1200,
  );
  const confidence = clampConfidence(input.parsed.confidence);
  const payload = isObjectRecord(input.parsed.payload) ? input.parsed.payload : {};

  if (messageType === "proposal") {
    return {
      schema: AGENT_ACT_SCHEMA_ID,
      messageType,
      summary,
      rationale,
      confidence,
      payload: {
        title: cleanText(payload.title, "Proposal"),
        plan: toStringArray(payload.plan, 8, [summary]),
        risks: toStringArray(payload.risks, 8, []),
      },
    };
  }

  if (messageType === "critique") {
    const severity =
      payload.severity === "low" ||
      payload.severity === "medium" ||
      payload.severity === "high"
        ? payload.severity
        : "medium";

    return {
      schema: AGENT_ACT_SCHEMA_ID,
      messageType,
      summary,
      rationale,
      confidence,
      payload: {
        issues: toStringArray(payload.issues, 10, [summary]),
        severity,
        requests: toStringArray(payload.requests, 8, []),
      },
    };
  }

  if (messageType === "vote_call") {
    const quorum = typeof payload.quorum === "number" && payload.quorum > 0
      ? Math.max(1, Math.min(20, Math.round(payload.quorum)))
      : 2;
    const options = toStringArray(payload.options, 6, [
      "approve",
      "revise",
      "reject",
    ]);

    return {
      schema: AGENT_ACT_SCHEMA_ID,
      messageType,
      summary,
      rationale,
      confidence,
      payload: {
        question: cleanText(payload.question, summary),
        options: options.length >= 2 ? options : ["approve", "reject"],
        quorum,
      },
    };
  }

  return {
    schema: AGENT_ACT_SCHEMA_ID,
    messageType: "decision",
    summary,
    rationale,
    confidence,
    payload: {
      decision: cleanText(payload.decision, summary),
      nextSteps: toStringArray(payload.nextSteps, 8, []),
    },
  };
}

export function validateAndRepairAgentActOutput(input: {
  rawResponseText: string;
  allowedMessageTypes: ChannelMessageType[];
  isLastQueuedTurn: boolean;
  fallbackSummary: string;
}): ValidationAndRepairResult {
  const cleaned = stripCodeFences(input.rawResponseText);
  const parsed = parseJsonObject(cleaned);

  if (parsed) {
    const validation = validateAgentActOutput(parsed, input.allowedMessageTypes);
    if (validation.ok) {
      return {
        output: validation.value,
        status: "valid",
        issues: [],
        repairSteps: [],
        parsed: true,
      };
    }

    const repaired = repairCandidateObject({
      parsed,
      allowedMessageTypes: input.allowedMessageTypes,
      isLastQueuedTurn: input.isLastQueuedTurn,
      fallbackSummary: input.fallbackSummary,
    });
    const repairedValidation = validateAgentActOutput(
      repaired,
      input.allowedMessageTypes,
    );
    if (repairedValidation.ok) {
      return {
        output: repairedValidation.value,
        status: "repaired",
        issues: validation.issues,
        repairSteps: ["schema-repair-coercion"],
        parsed: true,
      };
    }
  }

  const fallback = buildFallbackAgentActOutput({
    messageType: pickDefaultMessageType(
      input.allowedMessageTypes,
      input.isLastQueuedTurn,
    ),
    summary: input.fallbackSummary,
    rationale:
      "Fallback output applied because response was malformed or invalid.",
    confidence: 0.3,
  });

  return {
    output: fallback,
    status: "fallback",
    issues: [
      {
        path: "$",
        code: "FALLBACK",
        message: "Response was malformed or invalid; fallback output generated.",
      },
    ],
    repairSteps: ["fallback-output"],
    parsed: Boolean(parsed),
  };
}

export function validateToolCallOutput(
  value: unknown,
): { ok: true; value: ToolCallOutput } | { ok: false; issues: StructuredValidationIssue[] } {
  const issues: StructuredValidationIssue[] = [];
  if (!isObjectRecord(value)) {
    addIssue(issues, "$", "TYPE", "Tool call must be an object.");
    return { ok: false, issues };
  }

  if (value.schema !== TOOL_CALL_SCHEMA_ID) {
    addIssue(
      issues,
      "$.schema",
      "SCHEMA",
      `Tool call schema must be ${TOOL_CALL_SCHEMA_ID}.`,
    );
  }

  const tool = value.tool;
  if (
    tool !== "post_message" &&
    tool !== "request_vote" &&
    tool !== "fetch_mount" &&
    tool !== "checkpoint_state" &&
    tool !== "set_status"
  ) {
    addIssue(
      issues,
      "$.tool",
      "ENUM",
      "tool must be one of post_message|request_vote|fetch_mount|checkpoint_state|set_status.",
    );
  }

  if (!isObjectRecord(value.arguments)) {
    addIssue(issues, "$.arguments", "TYPE", "arguments must be an object.");
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: value as ToolCallOutput };
}
