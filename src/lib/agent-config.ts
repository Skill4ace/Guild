import type { Node } from "@xyflow/react";
import { AgentRole, Prisma, ThinkingProfile } from "@prisma/client";

import {
  AGENT_ROLE_META,
  type AgentNodeData,
  type AgentRole as BoardAgentRole,
  type AgentThinkingProfile,
  parseConstraints,
  sanitizeAgentNodeData,
} from "./board-state";

type AgentSyncDbClient = Pick<Prisma.TransactionClient, "agent">;

export type CompilerAgentConfig = {
  id: string;
  workspaceId: string;
  boardNodeId: string | null;
  name: string;
  role: BoardAgentRole;
  roleLabel: string;
  objective: string;
  authorityWeight: number;
  thinkingProfile: AgentThinkingProfile;
  privateMemoryEnabled: boolean;
  persona: string;
  constraints: string[];
  updatedAt: string;
};

export function toPrismaAgentRole(role: BoardAgentRole): AgentRole {
  if (role === "executive") return AgentRole.EXECUTIVE;
  if (role === "director") return AgentRole.DIRECTOR;
  if (role === "manager") return AgentRole.MANAGER;
  if (role === "specialist") return AgentRole.SPECIALIST;
  return AgentRole.OPERATOR;
}

export function fromPrismaAgentRole(role: AgentRole): BoardAgentRole {
  if (role === AgentRole.EXECUTIVE) return "executive";
  if (role === AgentRole.DIRECTOR) return "director";
  if (role === AgentRole.MANAGER) return "manager";
  if (role === AgentRole.SPECIALIST) return "specialist";
  return "operator";
}

export function toPrismaThinkingProfile(
  thinkingProfile: AgentThinkingProfile,
): ThinkingProfile {
  if (thinkingProfile === "fast") return ThinkingProfile.FAST;
  if (thinkingProfile === "deep") return ThinkingProfile.DEEP;
  return ThinkingProfile.STANDARD;
}

export function fromPrismaThinkingProfile(
  thinkingProfile: ThinkingProfile,
): AgentThinkingProfile {
  if (thinkingProfile === ThinkingProfile.FAST) return "fast";
  if (thinkingProfile === ThinkingProfile.DEEP) return "deep";
  return "standard";
}

export async function syncWorkspaceAgentsFromBoard(
  db: AgentSyncDbClient,
  workspaceId: string,
  nodes: Array<Node<AgentNodeData>>,
) {
  const seenNodeIds: string[] = [];

  for (const node of nodes) {
    const config = sanitizeAgentNodeData(node.data);
    seenNodeIds.push(node.id);

    await db.agent.upsert({
      where: {
        workspaceId_boardNodeId: {
          workspaceId,
          boardNodeId: node.id,
        },
      },
      update: {
        name: config.label,
        role: toPrismaAgentRole(config.role),
        objective: config.objective,
        authorityWeight: config.authorityWeight,
        thinkingProfile: toPrismaThinkingProfile(config.thinkingProfile),
        privateMemoryEnabled: config.privateMemoryEnabled,
        persona: config.persona || null,
        constraints: config.constraints,
      },
      create: {
        workspaceId,
        boardNodeId: node.id,
        name: config.label,
        role: toPrismaAgentRole(config.role),
        objective: config.objective,
        authorityWeight: config.authorityWeight,
        thinkingProfile: toPrismaThinkingProfile(config.thinkingProfile),
        privateMemoryEnabled: config.privateMemoryEnabled,
        persona: config.persona || null,
        constraints: config.constraints,
      },
    });
  }

  if (seenNodeIds.length === 0) {
    await db.agent.updateMany({
      where: {
        workspaceId,
        boardNodeId: { not: null },
      },
      data: {
        boardNodeId: null,
      },
    });

    return;
  }

  await db.agent.updateMany({
    where: {
      workspaceId,
      boardNodeId: { not: null },
      NOT: {
        boardNodeId: { in: seenNodeIds },
      },
    },
    data: {
      boardNodeId: null,
    },
  });
}

export function toCompilerAgentConfig(
  agent: {
    id: string;
    workspaceId: string;
    boardNodeId: string | null;
    name: string;
    role: AgentRole;
    objective: string | null;
    authorityWeight: number;
    thinkingProfile: ThinkingProfile;
    privateMemoryEnabled: boolean;
    persona: string | null;
    constraints: Prisma.JsonValue | null;
    updatedAt: Date;
  },
): CompilerAgentConfig {
  const role = fromPrismaAgentRole(agent.role);

  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    boardNodeId: agent.boardNodeId,
    name: agent.name,
    role,
    roleLabel: AGENT_ROLE_META[role].label,
    objective: agent.objective ?? "",
    authorityWeight: Math.max(1, Math.min(10, agent.authorityWeight)),
    thinkingProfile: fromPrismaThinkingProfile(agent.thinkingProfile),
    privateMemoryEnabled: agent.privateMemoryEnabled,
    persona: agent.persona ?? "",
    constraints: parseConstraints(agent.constraints),
    updatedAt: agent.updatedAt.toISOString(),
  };
}
