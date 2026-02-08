import type { Edge } from "@xyflow/react";
import { ChannelVisibility, Prisma } from "@prisma/client";

import {
  CHANNEL_MESSAGE_TYPE_ORDER,
  type ChannelEdgeData,
  type ChannelMessageType,
  sanitizeChannelEdgeData,
} from "./board-state";

type ChannelSyncDbClient = Pick<Prisma.TransactionClient, "agent" | "channel">;

type BoardAgentLink = {
  id: string;
  boardNodeId: string;
  name: string;
};

type PermissionCode =
  | "MESSAGE_TYPE_BLOCKED"
  | "WRITER_BLOCKED"
  | "READER_BLOCKED";

export type CompilerChannelConfig = {
  id: string;
  boardEdgeId: string | null;
  workspaceId: string;
  name: string;
  sourceAgentId: string;
  targetAgentId: string;
  stepOrder: number | null;
  visibility: "public" | "private";
  allowedMessageTypes: ChannelMessageType[];
  writerAgentIds: string[];
  readerAgentIds: string[];
  updatedAt: string;
};

export type RuntimeChannelPolicy = {
  sourceAgentId: string;
  targetAgentId: string;
  visibility: "public" | "private";
  allowedMessageTypes: ChannelMessageType[];
  writerAgentIds: string[];
  readerAgentIds: string[];
};

export type ChannelPermissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: PermissionCode;
      reason: string;
    };

function normalizeUnique(values: string[]): string[] {
  return values.filter((value, index, collection) => collection.indexOf(value) === index);
}

function parseJsonStringArray(value: Prisma.JsonValue | null): string[] {
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

function parseMessageTypes(value: Prisma.JsonValue | null): ChannelMessageType[] {
  if (!Array.isArray(value)) {
    return ["proposal"];
  }

  const parsed = value
    .filter((entry): entry is ChannelMessageType =>
      typeof entry === "string" &&
      (CHANNEL_MESSAGE_TYPE_ORDER as readonly string[]).includes(entry),
    )
    .slice(0, CHANNEL_MESSAGE_TYPE_ORDER.length);

  return parsed.length > 0 ? parsed : ["proposal"];
}

function parseStepOrderFromMetadata(value: Prisma.JsonValue | null): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const rawStep = (value as Record<string, unknown>).stepOrder;
  if (typeof rawStep !== "number" || !Number.isFinite(rawStep)) {
    return null;
  }

  return Math.max(1, Math.min(999, Math.round(rawStep)));
}

function sourceTargetDefaults(channel: Pick<RuntimeChannelPolicy, "sourceAgentId" | "targetAgentId">): string[] {
  return normalizeUnique([channel.sourceAgentId, channel.targetAgentId]);
}

export function toPrismaChannelVisibility(
  visibility: RuntimeChannelPolicy["visibility"],
): ChannelVisibility {
  return visibility === "private" ? ChannelVisibility.PRIVATE : ChannelVisibility.PUBLIC;
}

export function fromPrismaChannelVisibility(
  visibility: ChannelVisibility,
): RuntimeChannelPolicy["visibility"] {
  return visibility === ChannelVisibility.PRIVATE ? "private" : "public";
}

export async function syncWorkspaceChannelsFromBoard(
  db: ChannelSyncDbClient,
  workspaceId: string,
  edges: Array<Edge<ChannelEdgeData>>,
) {
  const agents = await db.agent.findMany({
    where: {
      workspaceId,
      boardNodeId: { not: null },
    },
    select: {
      id: true,
      boardNodeId: true,
      name: true,
    },
  });

  const agentByNodeId = new Map<string, BoardAgentLink>();
  for (const agent of agents) {
    if (agent.boardNodeId) {
      agentByNodeId.set(agent.boardNodeId, {
        id: agent.id,
        boardNodeId: agent.boardNodeId,
        name: agent.name,
      });
    }
  }

  const knownNodeIds = new Set(agentByNodeId.keys());
  const syncedEdgeIds = new Set<string>();

  for (const edge of edges) {
    if (syncedEdgeIds.has(edge.id)) {
      continue;
    }

    const sourceAgent = agentByNodeId.get(edge.source);
    const targetAgent = agentByNodeId.get(edge.target);
    if (!sourceAgent || !targetAgent) {
      continue;
    }

    const policy = sanitizeChannelEdgeData(edge.data, {
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      allowedNodeIds: knownNodeIds,
    });

    const writerAgentIds = normalizeUnique(
      policy.writerNodeIds
        .map((nodeId) => agentByNodeId.get(nodeId)?.id ?? null)
        .filter((id): id is string => id !== null),
    );
    const fallbackWriterAgentIds = normalizeUnique([sourceAgent.id, targetAgent.id]);

    const readerAgentIds = normalizeUnique(
      policy.readerNodeIds
        .map((nodeId) => agentByNodeId.get(nodeId)?.id ?? null)
        .filter((id): id is string => id !== null),
    );

    const effectiveWriterIds =
      writerAgentIds.length > 0 ? writerAgentIds : fallbackWriterAgentIds;
    const effectiveReaderIds =
      readerAgentIds.length > 0
        ? readerAgentIds
        : policy.visibility === "private"
          ? effectiveWriterIds
          : [];

    await db.channel.upsert({
      where: {
        workspaceId_boardEdgeId: {
          workspaceId,
          boardEdgeId: edge.id,
        },
      },
      update: {
        name: `${sourceAgent.name} to ${targetAgent.name}`,
        visibility: toPrismaChannelVisibility(policy.visibility),
        sourceAgentId: sourceAgent.id,
        targetAgentId: targetAgent.id,
        allowedMessageTypes: policy.messageTypes,
        writerAgentIds: effectiveWriterIds,
        readerAgentIds: effectiveReaderIds,
        metadata: {
          stepOrder: policy.stepOrder,
        },
      },
      create: {
        workspaceId,
        boardEdgeId: edge.id,
        name: `${sourceAgent.name} to ${targetAgent.name}`,
        visibility: toPrismaChannelVisibility(policy.visibility),
        sourceAgentId: sourceAgent.id,
        targetAgentId: targetAgent.id,
        allowedMessageTypes: policy.messageTypes,
        writerAgentIds: effectiveWriterIds,
        readerAgentIds: effectiveReaderIds,
        metadata: {
          stepOrder: policy.stepOrder,
        },
      },
    });

    syncedEdgeIds.add(edge.id);
  }

  if (syncedEdgeIds.size === 0) {
    await db.channel.deleteMany({
      where: {
        workspaceId,
        boardEdgeId: { not: null },
      },
    });

    return;
  }

  await db.channel.deleteMany({
    where: {
      workspaceId,
      boardEdgeId: { not: null, notIn: Array.from(syncedEdgeIds) },
    },
  });
}

export function toCompilerChannelConfig(channel: {
  id: string;
  boardEdgeId: string | null;
  workspaceId: string;
  name: string;
  sourceAgentId: string;
  targetAgentId: string;
  visibility: ChannelVisibility;
  allowedMessageTypes: Prisma.JsonValue | null;
  writerAgentIds: Prisma.JsonValue | null;
  readerAgentIds: Prisma.JsonValue | null;
  metadata?: Prisma.JsonValue | null;
  updatedAt: Date;
}): CompilerChannelConfig {
  return {
    id: channel.id,
    boardEdgeId: channel.boardEdgeId,
    workspaceId: channel.workspaceId,
    name: channel.name,
    sourceAgentId: channel.sourceAgentId,
    targetAgentId: channel.targetAgentId,
    stepOrder: parseStepOrderFromMetadata(channel.metadata ?? null),
    visibility: fromPrismaChannelVisibility(channel.visibility),
    allowedMessageTypes: parseMessageTypes(channel.allowedMessageTypes),
    writerAgentIds: parseJsonStringArray(channel.writerAgentIds),
    readerAgentIds: parseJsonStringArray(channel.readerAgentIds),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

export function canAgentWriteToChannel(
  channel: RuntimeChannelPolicy,
  actorAgentId: string,
  messageType: ChannelMessageType,
): ChannelPermissionDecision {
  const allowedMessageTypes =
    channel.allowedMessageTypes.length > 0
      ? channel.allowedMessageTypes
      : ["proposal"];

  if (!allowedMessageTypes.includes(messageType)) {
    return {
      allowed: false,
      code: "MESSAGE_TYPE_BLOCKED",
      reason: `Channel policy blocks message type \`${messageType}\`.`,
    };
  }

  const writers =
    channel.writerAgentIds.length > 0
      ? normalizeUnique(channel.writerAgentIds)
      : sourceTargetDefaults(channel);

  if (!writers.includes(actorAgentId)) {
    return {
      allowed: false,
      code: "WRITER_BLOCKED",
      reason: "Actor is not allowed to write into this channel.",
    };
  }

  return { allowed: true };
}

export function canAgentReadFromChannel(
  channel: RuntimeChannelPolicy,
  actorAgentId: string,
): ChannelPermissionDecision {
  const readers = normalizeUnique(channel.readerAgentIds);

  if (readers.length > 0) {
    if (readers.includes(actorAgentId)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      code: "READER_BLOCKED",
      reason: "Actor is not allowed to read this channel.",
    };
  }

  if (channel.visibility === "public") {
    return { allowed: true };
  }

  const privateReaders = sourceTargetDefaults(channel);
  if (privateReaders.includes(actorAgentId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "READER_BLOCKED",
    reason: "Private channel only allows source/target readers by default.",
  };
}

export function assertChannelWriteAllowed(
  channel: RuntimeChannelPolicy,
  actorAgentId: string,
  messageType: ChannelMessageType,
) {
  const decision = canAgentWriteToChannel(channel, actorAgentId, messageType);
  if (!decision.allowed) {
    throw new Error(`[${decision.code}] ${decision.reason}`);
  }
}
