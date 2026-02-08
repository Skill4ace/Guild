import {
  AgentRole,
  ChannelVisibility,
  MountAuditAction,
  MountScope,
  PolicyKind,
  PolicyScope,
  PrismaClient,
  RunStatus,
  RunTemplate,
  ThinkingProfile,
  TurnStatus,
  VoteStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = "guild-starter";
  await prisma.workspace.deleteMany({
    where: {
      slug: {
        in: [slug, "guild-demo"],
      },
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: "Guild Starter Workspace",
      slug,
      description: "Seeded starter workspace.",
    },
  });

  const execAgent = await prisma.agent.create({
    data: {
      workspaceId: workspace.id,
      boardNodeId: "seed-exec",
      name: "Avery Exec",
      role: AgentRole.EXECUTIVE,
      objective: "Finalize strategic decisions.",
      persona: "Calm decision-maker focused on impact and risk-adjusted outcomes.",
      constraints: ["Require evidence before approval", "Surface final tradeoffs"],
      authorityWeight: 5,
      thinkingProfile: ThinkingProfile.DEEP,
      privateMemoryEnabled: true,
    },
  });

  const qaAgent = await prisma.agent.create({
    data: {
      workspaceId: workspace.id,
      boardNodeId: "seed-qa",
      name: "Quinn QA",
      role: AgentRole.SPECIALIST,
      objective: "Block weak conclusions and request evidence.",
      persona: "Skeptical reviewer that stress-tests assumptions and quality claims.",
      constraints: ["Reject unsupported claims", "Demand explicit acceptance criteria"],
      authorityWeight: 3,
      thinkingProfile: ThinkingProfile.STANDARD,
    },
  });

  const mediatorAgent = await prisma.agent.create({
    data: {
      workspaceId: workspace.id,
      boardNodeId: "seed-mediator",
      name: "Morgan Mediator",
      role: AgentRole.DIRECTOR,
      objective: "Resolve deadlocks and guide consensus.",
      persona: "Coordinator that keeps teams aligned and deadlines realistic.",
      constraints: ["Escalate unresolved conflicts", "Summarize options before voting"],
      authorityWeight: 4,
      thinkingProfile: ThinkingProfile.DEEP,
    },
  });

  const channel = await prisma.channel.create({
    data: {
      workspaceId: workspace.id,
      boardEdgeId: "seed-channel-1",
      name: "Decision Review",
      description: "Exec and QA channel for proposals and critiques.",
      visibility: ChannelVisibility.PRIVATE,
      sourceAgentId: execAgent.id,
      targetAgentId: qaAgent.id,
      allowedMessageTypes: ["proposal", "critique", "vote_call", "decision"],
      readerAgentIds: [execAgent.id, qaAgent.id, mediatorAgent.id],
      writerAgentIds: [execAgent.id, qaAgent.id],
    },
  });

  await prisma.boardState.create({
    data: {
      workspaceId: workspace.id,
      nodes: [
        {
          id: "seed-exec",
          type: "agent",
          position: { x: 120, y: 120 },
          data: {
            label: execAgent.name,
            role: "executive",
            objective: execAgent.objective,
            persona: execAgent.persona,
            constraints: execAgent.constraints,
            authorityWeight: execAgent.authorityWeight,
            thinkingProfile: "deep",
            privateMemoryEnabled: execAgent.privateMemoryEnabled,
          },
        },
        {
          id: "seed-qa",
          type: "agent",
          position: { x: 420, y: 120 },
          data: {
            label: qaAgent.name,
            role: "specialist",
            objective: qaAgent.objective,
            persona: qaAgent.persona,
            constraints: qaAgent.constraints,
            authorityWeight: qaAgent.authorityWeight,
            thinkingProfile: "standard",
            privateMemoryEnabled: qaAgent.privateMemoryEnabled,
          },
        },
        {
          id: "seed-mediator",
          type: "agent",
          position: { x: 280, y: 280 },
          data: {
            label: mediatorAgent.name,
            role: "director",
            objective: mediatorAgent.objective,
            persona: mediatorAgent.persona,
            constraints: mediatorAgent.constraints,
            authorityWeight: mediatorAgent.authorityWeight,
            thinkingProfile: "deep",
            privateMemoryEnabled: mediatorAgent.privateMemoryEnabled,
          },
        },
      ],
      edges: [
        {
          id: "seed-channel-1",
          source: "seed-exec",
          target: "seed-qa",
          type: "smoothstep",
          data: {
            visibility: "private",
            messageTypes: ["proposal", "critique", "vote_call", "decision"],
            writerNodeIds: ["seed-exec", "seed-qa"],
            readerNodeIds: ["seed-exec", "seed-qa", "seed-mediator"],
          },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1.05 },
    },
  });

  const vaultItem = await prisma.vaultItem.create({
    data: {
      workspaceId: workspace.id,
      name: "Brand Rule Pack",
      fileName: "brand-rules-v1.md",
      mimeType: "text/markdown",
      byteSize: 5820,
      storageKey: "seed/brand-rules-v1.md",
      tags: ["rules", "brand", "reference"],
    },
  });

  const run = await prisma.run.create({
    data: {
      workspaceId: workspace.id,
      name: "Org Template Demo Run",
      template: RunTemplate.ORG,
      status: RunStatus.DRAFT,
      boardSnapshot: {
        agents: [execAgent.id, qaAgent.id, mediatorAgent.id],
        channels: [channel.id],
      },
      state: {
        objective: "Approve or reject the launch brief.",
      },
    },
  });

  await prisma.mount.create({
    data: {
      workspaceId: workspace.id,
      vaultItemId: vaultItem.id,
      scope: MountScope.RUN,
      runId: run.id,
    },
  });

  await prisma.mountAuditEntry.create({
    data: {
      workspaceId: workspace.id,
      mountId: null,
      action: MountAuditAction.CREATED,
      scope: MountScope.RUN,
      vaultItemId: vaultItem.id,
      runId: run.id,
      actorName: "seed",
    },
  });

  await prisma.policy.create({
    data: {
      workspaceId: workspace.id,
      name: "QA Approval Gate",
      kind: PolicyKind.APPROVAL,
      scope: PolicyScope.RUN,
      runId: run.id,
      config: {
        requiredRoles: [AgentRole.SPECIALIST],
        action: "block_finalize_without_qa_approval",
      },
    },
  });

  await prisma.turn.create({
    data: {
      runId: run.id,
      sequence: 1,
      actorAgentId: execAgent.id,
      channelId: channel.id,
      status: TurnStatus.QUEUED,
      input: {
        prompt: "Draft launch proposal for review.",
      },
    },
  });

  await prisma.vote.create({
    data: {
      workspaceId: workspace.id,
      runId: run.id,
      question: "Approve launch proposal v1?",
      status: VoteStatus.OPEN,
      quorum: 2,
      threshold: 6,
      options: ["approve", "reject", "revise"],
      weights: {
        [execAgent.id]: 5,
        [qaAgent.id]: 3,
        [mediatorAgent.id]: 4,
      },
    },
  });

  const counts = await Promise.all([
    prisma.workspace.count(),
    prisma.boardState.count({ where: { workspaceId: workspace.id } }),
    prisma.agent.count({ where: { workspaceId: workspace.id } }),
    prisma.channel.count({ where: { workspaceId: workspace.id } }),
    prisma.vaultItem.count({ where: { workspaceId: workspace.id } }),
    prisma.mount.count({ where: { workspaceId: workspace.id } }),
    prisma.mountAuditEntry.count({ where: { workspaceId: workspace.id } }),
    prisma.run.count({ where: { workspaceId: workspace.id } }),
    prisma.turn.count({ where: { runId: run.id } }),
    prisma.vote.count({ where: { runId: run.id } }),
    prisma.policy.count({ where: { workspaceId: workspace.id } }),
  ]);

  console.log("Seed completed", {
    workspaceId: workspace.id,
    counts: {
      workspaces: counts[0],
      boardStates: counts[1],
      agents: counts[2],
      channels: counts[3],
      vaultItems: counts[4],
      mounts: counts[5],
      mountAuditEntries: counts[6],
      runs: counts[7],
      turns: counts[8],
      votes: counts[9],
      policies: counts[10],
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
