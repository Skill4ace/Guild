import type { PrismaClient } from "@prisma/client";

import type { AgentRole, ChannelMessageType } from "./board-state";
import {
  canAgentReadFromChannel,
  canAgentWriteToChannel,
  type RuntimeChannelPolicy,
} from "./channel-config";
import type { ResolvedMountContextItem } from "./mount-manager";
import {
  TOOL_CALL_SCHEMA_ID,
  validateToolCallOutput,
  type StructuredValidationIssue,
  type ToolCallOutput,
} from "./structured-output";

export type ToolGatewayDbClient = Pick<PrismaClient, "vote">;

export type ToolGatewayBlockCode =
  | "VALIDATION_FAILED"
  | "POLICY_BLOCKED"
  | "TOOL_SCOPE_BLOCKED"
  | "RESOURCE_NOT_FOUND"
  | "RUNTIME_ERROR";

export type ToolGatewayCallStatus = "executed" | "blocked" | "invalid";

export type ToolGatewayCallEvent = {
  schema: typeof TOOL_CALL_SCHEMA_ID;
  index: number;
  tool: string;
  status: ToolGatewayCallStatus;
  arguments: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  blockCode: ToolGatewayBlockCode | null;
  message: string | null;
  validationIssues: StructuredValidationIssue[];
  createdAt: string;
};

export type ToolGatewaySummary = {
  requested: number;
  executed: number;
  blocked: number;
  invalid: number;
};

export type ToolGatewayBatchResult = {
  events: ToolGatewayCallEvent[];
  summary: ToolGatewaySummary;
  voteIds: string[];
  checkpointLabels: string[];
  requestedRunStatus: RequestedRunStatus | null;
};

type ExecuteToolGatewayBatchInput = {
  db: ToolGatewayDbClient;
  workspaceId: string;
  runId: string;
  turnId: string;
  sequence: number;
  actorAgentId: string;
  actorRole: AgentRole;
  channelId: string;
  channelPolicy: RuntimeChannelPolicy;
  mountedItems: ResolvedMountContextItem[];
  toolCalls: unknown[];
};

const RUN_STATUS_REQUESTS = [
  "DRAFT",
  "QUEUED",
  "RUNNING",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;

export type RequestedRunStatus = (typeof RUN_STATUS_REQUESTS)[number];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildIssue(
  path: string,
  code: string,
  message: string,
): StructuredValidationIssue {
  return { path, code, message };
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function cleanStringArray(
  value: unknown,
  minItems: number,
  maxItems: number,
  maxItemLength: number,
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, maxItemLength))
    .filter((entry, index, collection) => collection.indexOf(entry) === index)
    .slice(0, maxItems);

  if (parsed.length < minItems) {
    return null;
  }

  return parsed;
}

function normalizeMessageType(value: unknown): ChannelMessageType | null {
  if (value === "proposal") return value;
  if (value === "critique") return value;
  if (value === "vote_call") return value;
  if (value === "decision") return value;
  return null;
}

function normalizeRunStatus(value: unknown): RequestedRunStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  for (const status of RUN_STATUS_REQUESTS) {
    if (normalized === status) {
      return status;
    }
  }

  return null;
}

function parseOptionalPositiveInt(
  value: unknown,
  min: number,
  max: number,
): number | null | "invalid" {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "invalid";
  }

  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    return "invalid";
  }

  return rounded;
}

function eventBase(input: {
  index: number;
  tool: string;
  args: Record<string, unknown> | null;
}) {
  return {
    schema: TOOL_CALL_SCHEMA_ID,
    index: input.index,
    tool: input.tool,
    arguments: input.args,
    createdAt: new Date().toISOString(),
  } as const;
}

function recordInvalidEvent(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  tool: string;
  args: Record<string, unknown> | null;
  message: string;
  issues: StructuredValidationIssue[];
}) {
  input.events.push({
    ...eventBase({
      index: input.index,
      tool: input.tool,
      args: input.args,
    }),
    status: "invalid",
    result: null,
    blockCode: "VALIDATION_FAILED",
    message: input.message,
    validationIssues: input.issues,
  });
}

function recordBlockedEvent(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  tool: string;
  args: Record<string, unknown> | null;
  blockCode: Exclude<ToolGatewayBlockCode, "VALIDATION_FAILED">;
  message: string;
}) {
  input.events.push({
    ...eventBase({
      index: input.index,
      tool: input.tool,
      args: input.args,
    }),
    status: "blocked",
    result: null,
    blockCode: input.blockCode,
    message: input.message,
    validationIssues: [],
  });
}

function recordExecutedEvent(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  tool: string;
  args: Record<string, unknown> | null;
  result: Record<string, unknown>;
}) {
  input.events.push({
    ...eventBase({
      index: input.index,
      tool: input.tool,
      args: input.args,
    }),
    status: "executed",
    result: input.result,
    blockCode: null,
    message: null,
    validationIssues: [],
  });
}

function argsWithDefaults(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

async function executePostMessageTool(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  args: Record<string, unknown>;
  actorAgentId: string;
  channelId: string;
  channelPolicy: RuntimeChannelPolicy;
}) {
  const tool = "post_message";
  const channelId = cleanString(input.args.channelId, 120);
  const content = cleanString(input.args.content, 1500);
  const messageType = normalizeMessageType(input.args.messageType);
  const issues: StructuredValidationIssue[] = [];

  if (!channelId) {
    issues.push(buildIssue("$.arguments.channelId", "STRING", "channelId is required."));
  }
  if (!messageType) {
    issues.push(
      buildIssue(
        "$.arguments.messageType",
        "ENUM",
        "messageType must be proposal|critique|vote_call|decision.",
      ),
    );
  }
  if (!content) {
    issues.push(buildIssue("$.arguments.content", "STRING", "content is required."));
  }
  if (issues.length > 0) {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "post_message arguments are invalid.",
      issues,
    });
    return;
  }
  const safeChannelId = channelId as string;
  const safeMessageType = messageType as ChannelMessageType;
  const safeContent = content as string;

  if (safeChannelId !== input.channelId) {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "TOOL_SCOPE_BLOCKED",
      message: "post_message can only target the turn channel.",
    });
    return;
  }

  const writeDecision = canAgentWriteToChannel(
    input.channelPolicy,
    input.actorAgentId,
    safeMessageType,
  );
  if (!writeDecision.allowed) {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "POLICY_BLOCKED",
      message: writeDecision.reason,
    });
    return;
  }

  recordExecutedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      result: {
        channelId: safeChannelId,
        messageType: safeMessageType,
        contentPreview: safeContent.slice(0, 240),
        characterCount: safeContent.length,
      },
    });
}

async function executeFetchMountTool(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  args: Record<string, unknown>;
  actorAgentId: string;
  channelPolicy: RuntimeChannelPolicy;
  mountedItems: ResolvedMountContextItem[];
}) {
  const tool = "fetch_mount";
  const vaultItemId = cleanString(input.args.vaultItemId, 120);
  const issues: StructuredValidationIssue[] = [];

  if (!vaultItemId) {
    issues.push(
      buildIssue("$.arguments.vaultItemId", "STRING", "vaultItemId is required."),
    );
  }
  if (issues.length > 0) {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "fetch_mount arguments are invalid.",
      issues,
    });
    return;
  }

  const readDecision = canAgentReadFromChannel(
    input.channelPolicy,
    input.actorAgentId,
  );
  if (!readDecision.allowed) {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "POLICY_BLOCKED",
      message: readDecision.reason,
    });
    return;
  }

  const mountItem = input.mountedItems.find(
    (item) => item.vaultItemId === vaultItemId,
  );
  if (!mountItem) {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "RESOURCE_NOT_FOUND",
      message: "Requested mount item is not available in this turn context.",
    });
    return;
  }

  recordExecutedEvent({
    events: input.events,
    index: input.index,
    tool,
    args: input.args,
    result: {
      vaultItemId: mountItem.vaultItemId,
      name: mountItem.name,
      fileName: mountItem.fileName,
      mimeType: mountItem.mimeType,
      byteSize: mountItem.byteSize,
      mountedByScopes: mountItem.mountedByScopes,
      tags: mountItem.tags,
    },
  });
}

async function executeRequestVoteTool(input: {
  db: ToolGatewayDbClient;
  events: ToolGatewayCallEvent[];
  index: number;
  args: Record<string, unknown>;
  workspaceId: string;
  runId: string;
  actorAgentId: string;
  channelPolicy: RuntimeChannelPolicy;
}): Promise<string | null> {
  const tool = "request_vote";
  const question = cleanString(input.args.question, 400);
  const options = cleanStringArray(input.args.options, 2, 8, 120);
  const issues: StructuredValidationIssue[] = [];

  if (!question) {
    issues.push(buildIssue("$.arguments.question", "STRING", "question is required."));
  }
  if (!options) {
    issues.push(
      buildIssue(
        "$.arguments.options",
        "ARRAY",
        "options requires at least two unique strings.",
      ),
    );
  }
  if (issues.length > 0) {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "request_vote arguments are invalid.",
      issues,
    });
    return null;
  }
  const safeQuestion = question as string;
  const safeOptions = options as string[];

  const writeDecision = canAgentWriteToChannel(
    input.channelPolicy,
    input.actorAgentId,
    "vote_call",
  );
  if (!writeDecision.allowed) {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "POLICY_BLOCKED",
      message: writeDecision.reason,
    });
    return null;
  }

  const quorum = parseOptionalPositiveInt(
    input.args.quorum,
    1,
    Math.max(1, safeOptions.length),
  );
  if (quorum === "invalid") {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "request_vote quorum is invalid.",
      issues: [
        buildIssue(
          "$.arguments.quorum",
          "INTEGER",
          "quorum must be a positive integer within option count.",
        ),
      ],
    });
    return null;
  }

  const threshold = parseOptionalPositiveInt(
    input.args.threshold,
    1,
    Math.max(1, safeOptions.length),
  );
  if (threshold === "invalid") {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "request_vote threshold is invalid.",
      issues: [
        buildIssue(
          "$.arguments.threshold",
          "INTEGER",
          "threshold must be a positive integer within option count.",
        ),
      ],
    });
    return null;
  }

  try {
    const vote = await input.db.vote.create({
      data: {
        workspaceId: input.workspaceId,
        runId: input.runId,
        question: safeQuestion,
        options: safeOptions,
        quorum,
        threshold,
        weights: {},
        ballots: {},
      },
      select: {
        id: true,
        question: true,
      },
    });

    recordExecutedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      result: {
        voteId: vote.id,
        question: vote.question,
        optionCount: safeOptions.length,
      },
    });
    return vote.id;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Vote creation failed at runtime.";
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "RUNTIME_ERROR",
      message,
    });
    return null;
  }
}

async function executeCheckpointTool(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  args: Record<string, unknown>;
  actorAgentId: string;
  channelPolicy: RuntimeChannelPolicy;
}): Promise<string | null> {
  const tool = "checkpoint_state";
  const label = cleanString(input.args.label, 120);
  const statePatch = isObjectRecord(input.args.statePatch)
    ? input.args.statePatch
    : null;
  const issues: StructuredValidationIssue[] = [];

  if (!label) {
    issues.push(buildIssue("$.arguments.label", "STRING", "label is required."));
  }
  if (!statePatch) {
    issues.push(
      buildIssue(
        "$.arguments.statePatch",
        "OBJECT",
        "statePatch must be a JSON object.",
      ),
    );
  }
  if (issues.length > 0) {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "checkpoint_state arguments are invalid.",
      issues,
    });
    return null;
  }
  const safeLabel = label as string;
  const safeStatePatch = statePatch as Record<string, unknown>;

  const guardMessageType = input.channelPolicy.allowedMessageTypes[0] ?? "proposal";
  const writeDecision = canAgentWriteToChannel(
    input.channelPolicy,
    input.actorAgentId,
    guardMessageType,
  );
  if (!writeDecision.allowed) {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "POLICY_BLOCKED",
      message: writeDecision.reason,
    });
    return null;
  }

  recordExecutedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      result: {
        label: safeLabel,
        patchKeys: Object.keys(safeStatePatch).slice(0, 12),
        patchSize: JSON.stringify(safeStatePatch).length,
      },
    });
  return safeLabel;
}

async function executeSetStatusTool(input: {
  events: ToolGatewayCallEvent[];
  index: number;
  args: Record<string, unknown>;
  actorRole: AgentRole;
}): Promise<RequestedRunStatus | null> {
  const tool = "set_status";
  const status = normalizeRunStatus(input.args.status);
  if (!status) {
    recordInvalidEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      message: "set_status status is invalid.",
      issues: [
        buildIssue(
          "$.arguments.status",
          "ENUM",
          `status must be one of ${RUN_STATUS_REQUESTS.join(", ")}.`,
        ),
      ],
    });
    return null;
  }

  if (input.actorRole !== "executive" && input.actorRole !== "director") {
    recordBlockedEvent({
      events: input.events,
      index: input.index,
      tool,
      args: input.args,
      blockCode: "POLICY_BLOCKED",
      message: "Only executive/director roles can request run status changes.",
    });
    return null;
  }

  recordExecutedEvent({
    events: input.events,
    index: input.index,
    tool,
    args: input.args,
    result: { requestedRunStatus: status },
  });
  return status;
}

export async function executeToolGatewayBatch(
  input: ExecuteToolGatewayBatchInput,
): Promise<ToolGatewayBatchResult> {
  const events: ToolGatewayCallEvent[] = [];
  const voteIds: string[] = [];
  const checkpointLabels: string[] = [];
  let requestedRunStatus: RequestedRunStatus | null = null;

  for (const [index, rawCall] of input.toolCalls.entries()) {
    const validated = validateToolCallOutput(rawCall);
    if (!validated.ok) {
      const tool =
        isObjectRecord(rawCall) && typeof rawCall.tool === "string"
          ? rawCall.tool
          : "unknown";
      const args =
        isObjectRecord(rawCall) && isObjectRecord(rawCall.arguments)
          ? rawCall.arguments
          : null;
      recordInvalidEvent({
        events,
        index,
        tool,
        args,
        message: "Tool call shape failed schema validation.",
        issues: validated.issues,
      });
      continue;
    }

    const call = validated.value;
    const args = argsWithDefaults(call.arguments);

    if (call.tool === "post_message") {
      await executePostMessageTool({
        events,
        index,
        args,
        actorAgentId: input.actorAgentId,
        channelId: input.channelId,
        channelPolicy: input.channelPolicy,
      });
      continue;
    }

    if (call.tool === "request_vote") {
      const voteId = await executeRequestVoteTool({
        db: input.db,
        events,
        index,
        args,
        workspaceId: input.workspaceId,
        runId: input.runId,
        actorAgentId: input.actorAgentId,
        channelPolicy: input.channelPolicy,
      });
      if (voteId) {
        voteIds.push(voteId);
      }
      continue;
    }

    if (call.tool === "fetch_mount") {
      await executeFetchMountTool({
        events,
        index,
        args,
        actorAgentId: input.actorAgentId,
        channelPolicy: input.channelPolicy,
        mountedItems: input.mountedItems,
      });
      continue;
    }

    if (call.tool === "checkpoint_state") {
      const label = await executeCheckpointTool({
        events,
        index,
        args,
        actorAgentId: input.actorAgentId,
        channelPolicy: input.channelPolicy,
      });
      if (label) {
        checkpointLabels.push(label);
      }
      continue;
    }

    if (call.tool === "set_status") {
      const status = await executeSetStatusTool({
        events,
        index,
        args,
        actorRole: input.actorRole,
      });
      if (status) {
        requestedRunStatus = status;
      }
      continue;
    }
  }

  const summary: ToolGatewaySummary = {
    requested: input.toolCalls.length,
    executed: events.filter((event) => event.status === "executed").length,
    blocked: events.filter((event) => event.status === "blocked").length,
    invalid: events.filter((event) => event.status === "invalid").length,
  };

  return {
    events,
    summary,
    voteIds,
    checkpointLabels,
    requestedRunStatus,
  };
}

function tryReadVoteQuestion(payload: unknown, summaryFallback: string): string {
  if (!isObjectRecord(payload)) {
    return summaryFallback;
  }

  const question = cleanString(payload.question, 400);
  return question ?? summaryFallback;
}

function tryReadVoteOptions(payload: unknown): string[] {
  if (!isObjectRecord(payload)) {
    return ["approve", "revise", "reject"];
  }

  const parsed = cleanStringArray(payload.options, 2, 8, 120);
  return parsed ?? ["approve", "revise", "reject"];
}

function tryReadVoteQuorum(payload: unknown, fallback: number): number {
  if (!isObjectRecord(payload)) {
    return fallback;
  }

  const quorum = parseOptionalPositiveInt(payload.quorum, 1, 8);
  if (typeof quorum === "number") {
    return quorum;
  }

  return fallback;
}

export function buildDefaultToolCallsForTurn(input: {
  channelId: string;
  sequence: number;
  messageType: ChannelMessageType;
  summary: string;
  confidence: number;
  payload: unknown;
  mountItemIds: string[];
}): ToolCallOutput[] {
  const calls: ToolCallOutput[] = [
    {
      schema: TOOL_CALL_SCHEMA_ID,
      tool: "post_message",
      arguments: {
        channelId: input.channelId,
        messageType: input.messageType,
        content: input.summary,
      },
    },
  ];

  const firstMount = input.mountItemIds[0];
  if (firstMount) {
    calls.push({
      schema: TOOL_CALL_SCHEMA_ID,
      tool: "fetch_mount",
      arguments: {
        vaultItemId: firstMount,
      },
    });
  }

  if (input.messageType === "vote_call") {
    const options = tryReadVoteOptions(input.payload);
    calls.push({
      schema: TOOL_CALL_SCHEMA_ID,
      tool: "request_vote",
      arguments: {
        question: tryReadVoteQuestion(input.payload, input.summary),
        options,
        quorum: tryReadVoteQuorum(input.payload, Math.min(2, options.length)),
      },
    });
  }

  calls.push({
    schema: TOOL_CALL_SCHEMA_ID,
    tool: "checkpoint_state",
    arguments: {
      label: `turn-${input.sequence}`,
      statePatch: {
        messageType: input.messageType,
        summary: input.summary.slice(0, 180),
        confidence: input.confidence,
      },
    },
  });

  if (input.messageType === "decision") {
    calls.push({
      schema: TOOL_CALL_SCHEMA_ID,
      tool: "set_status",
      arguments: {
        status: "COMPLETED",
      },
    });
  }

  return calls;
}
