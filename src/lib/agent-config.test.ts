import { AgentRole, ThinkingProfile } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  fromPrismaAgentRole,
  fromPrismaThinkingProfile,
  toCompilerAgentConfig,
  toPrismaAgentRole,
  toPrismaThinkingProfile,
} from "./agent-config";

describe("agent-config", () => {
  it("maps board roles to Prisma roles", () => {
    expect(toPrismaAgentRole("executive")).toBe(AgentRole.EXECUTIVE);
    expect(toPrismaAgentRole("director")).toBe(AgentRole.DIRECTOR);
    expect(toPrismaAgentRole("manager")).toBe(AgentRole.MANAGER);
    expect(toPrismaAgentRole("specialist")).toBe(AgentRole.SPECIALIST);
    expect(toPrismaAgentRole("operator")).toBe(AgentRole.OPERATOR);
  });

  it("maps Prisma roles to board roles", () => {
    expect(fromPrismaAgentRole(AgentRole.EXECUTIVE)).toBe("executive");
    expect(fromPrismaAgentRole(AgentRole.DIRECTOR)).toBe("director");
    expect(fromPrismaAgentRole(AgentRole.MANAGER)).toBe("manager");
    expect(fromPrismaAgentRole(AgentRole.SPECIALIST)).toBe("specialist");
    expect(fromPrismaAgentRole(AgentRole.OPERATOR)).toBe("operator");
  });

  it("maps thinking profiles", () => {
    expect(toPrismaThinkingProfile("fast")).toBe(ThinkingProfile.FAST);
    expect(toPrismaThinkingProfile("standard")).toBe(ThinkingProfile.STANDARD);
    expect(toPrismaThinkingProfile("deep")).toBe(ThinkingProfile.DEEP);
    expect(fromPrismaThinkingProfile(ThinkingProfile.FAST)).toBe("fast");
    expect(fromPrismaThinkingProfile(ThinkingProfile.STANDARD)).toBe("standard");
    expect(fromPrismaThinkingProfile(ThinkingProfile.DEEP)).toBe("deep");
  });

  it("normalizes compiler agent configs", () => {
    const normalized = toCompilerAgentConfig({
      id: "agent-1",
      workspaceId: "workspace-1",
      boardNodeId: "node-1",
      name: "Ops Agent",
      role: AgentRole.OPERATOR,
      objective: "Execute tasks",
      authorityWeight: 14,
      thinkingProfile: ThinkingProfile.FAST,
      privateMemoryEnabled: false,
      persona: null,
      constraints: ["No scope creep", "Provide status updates"],
      updatedAt: new Date("2026-02-06T18:00:00.000Z"),
    });

    expect(normalized.role).toBe("operator");
    expect(normalized.authorityWeight).toBe(10);
    expect(normalized.constraints).toEqual([
      "No scope creep",
      "Provide status updates",
    ]);
    expect(normalized.persona).toBe("");
  });
});
