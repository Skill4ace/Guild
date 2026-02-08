import { execSync } from "node:child_process";

import {
  AgentRole,
  ChannelVisibility,
  MountScope,
  PolicyKind,
  PolicyScope,
  PrismaClient,
  RunStatus,
  RunTemplate,
  TurnStatus,
  VoteStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDbTests = process.env.RUN_DB_TESTS === "true";
const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://guild:guild@localhost:5432/guild?schema=test_module2";
const adminDbUrl =
  process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://guild:guild@localhost:5432/guild?schema=public";
const schemaName =
  new URL(testDbUrl).searchParams.get("schema") ?? "test_module2";

let prisma: PrismaClient | undefined;

beforeAll(async () => {
  if (!runDbTests) {
    return;
  }

  const adminPrisma = new PrismaClient({
    datasources: { db: { url: adminDbUrl } },
  });

  await adminPrisma.$connect();
  await adminPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  await adminPrisma.$disconnect();

  execSync(
    "npx prisma db push --skip-generate",
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
      },
      stdio: "pipe",
    },
  );

  prisma = new PrismaClient({
    datasources: {
      db: { url: testDbUrl },
    },
  });

  await prisma.$connect();
}, 30_000);

afterAll(async () => {
  if (!runDbTests) {
    return;
  }

  if (prisma) {
    await prisma.$disconnect();
  }
}, 30_000);

const dbDescribe = runDbTests ? describe : describe.skip;

dbDescribe("Prisma CRUD", () => {
  it("creates, reads, updates, and deletes core entities", async () => {
    const workspace = await prisma.workspace.create({
      data: {
        name: "CRUD Workspace",
        slug: "crud-workspace",
        description: "Integration test workspace",
      },
    });

    const sourceAgent = await prisma.agent.create({
      data: {
        workspaceId: workspace.id,
        boardNodeId: "node-source",
        name: "Source Agent",
        role: AgentRole.OPERATOR,
        persona: "Execution-focused implementer.",
        constraints: ["Respect assigned scope"],
      },
    });

    const targetAgent = await prisma.agent.create({
      data: {
        workspaceId: workspace.id,
        boardNodeId: "node-target",
        name: "Target Agent",
        role: AgentRole.SPECIALIST,
      },
    });

    const channel = await prisma.channel.create({
      data: {
        workspaceId: workspace.id,
        name: "Agent Channel",
        visibility: ChannelVisibility.PUBLIC,
        sourceAgentId: sourceAgent.id,
        targetAgentId: targetAgent.id,
        allowedMessageTypes: ["proposal", "critique"],
      },
    });

    const boardState = await prisma.boardState.create({
      data: {
        workspaceId: workspace.id,
        nodes: [
          {
            id: "node-1",
            type: "agent",
            position: { x: 100, y: 100 },
            data: {
              label: "Source Agent",
              role: "operator",
              objective: "Execute assigned work.",
              persona: "Pragmatic implementer",
              constraints: ["No scope creep"],
              authorityWeight: 1,
              thinkingProfile: "fast",
              privateMemoryEnabled: false,
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });

    const vaultItem = await prisma.vaultItem.create({
      data: {
        workspaceId: workspace.id,
        name: "Rules",
        fileName: "rules.md",
        mimeType: "text/markdown",
        byteSize: 100,
        storageKey: "tests/rules.md",
      },
    });

    const run = await prisma.run.create({
      data: {
        workspaceId: workspace.id,
        template: RunTemplate.DEBATE,
        status: RunStatus.QUEUED,
      },
    });

    const turn = await prisma.turn.create({
      data: {
        runId: run.id,
        sequence: 1,
        actorAgentId: sourceAgent.id,
        channelId: channel.id,
        status: TurnStatus.QUEUED,
      },
    });

    const vote = await prisma.vote.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        question: "Ship proposal?",
        status: VoteStatus.OPEN,
      },
    });

    const policy = await prisma.policy.create({
      data: {
        workspaceId: workspace.id,
        name: "Exec Approval",
        kind: PolicyKind.APPROVAL,
        scope: PolicyScope.RUN,
        runId: run.id,
        config: { requiredRole: AgentRole.EXECUTIVE },
      },
    });

    const mount = await prisma.mount.create({
      data: {
        workspaceId: workspace.id,
        vaultItemId: vaultItem.id,
        scope: MountScope.RUN,
        runId: run.id,
      },
    });

    const loadedRun = await prisma.run.findUnique({
      where: { id: run.id },
      include: { turns: true, votes: true, policies: true, mounts: true },
    });

    expect(loadedRun?.id).toBe(run.id);
    expect(loadedRun?.turns.length).toBe(1);
    expect(loadedRun?.votes.length).toBe(1);
    expect(loadedRun?.policies.length).toBe(1);
    expect(loadedRun?.mounts.length).toBe(1);

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { description: "updated description" },
    });

    await prisma.agent.update({
      where: { id: sourceAgent.id },
      data: { authorityWeight: 2 },
    });

    await prisma.channel.update({
      where: { id: channel.id },
      data: { visibility: ChannelVisibility.PRIVATE },
    });

    await prisma.vaultItem.update({
      where: { id: vaultItem.id },
      data: { tags: ["test", "updated"] },
    });

    await prisma.run.update({
      where: { id: run.id },
      data: { status: RunStatus.RUNNING },
    });

    await prisma.turn.update({
      where: { id: turn.id },
      data: { status: TurnStatus.COMPLETED },
    });

    await prisma.vote.update({
      where: { id: vote.id },
      data: { status: VoteStatus.CLOSED },
    });

    await prisma.policy.update({
      where: { id: policy.id },
      data: { isActive: false },
    });

    await prisma.mount.update({
      where: { id: mount.id },
      data: { scope: MountScope.CHANNEL, channelId: channel.id, runId: null },
    });

    await prisma.boardState.update({
      where: { id: boardState.id },
      data: { viewport: { x: 10, y: 12, zoom: 1.1 } },
    });

    const [workspaceCount, boardStateCount, agentCount, channelCount, vaultCount, mountCount, runCount, turnCount, voteCount, policyCount] =
      await Promise.all([
        prisma.workspace.count(),
        prisma.boardState.count(),
        prisma.agent.count(),
        prisma.channel.count(),
        prisma.vaultItem.count(),
        prisma.mount.count(),
        prisma.run.count(),
        prisma.turn.count(),
        prisma.vote.count(),
        prisma.policy.count(),
      ]);

    expect(workspaceCount).toBe(1);
    expect(boardStateCount).toBe(1);
    expect(agentCount).toBe(2);
    expect(channelCount).toBe(1);
    expect(vaultCount).toBe(1);
    expect(mountCount).toBe(1);
    expect(runCount).toBe(1);
    expect(turnCount).toBe(1);
    expect(voteCount).toBe(1);
    expect(policyCount).toBe(1);

    await prisma.workspace.delete({ where: { id: workspace.id } });

    const [workspaceAfterDelete, boardStateAfterDelete, agentAfterDelete, channelAfterDelete, vaultAfterDelete, mountAfterDelete, runAfterDelete, turnAfterDelete, voteAfterDelete, policyAfterDelete] =
      await Promise.all([
        prisma.workspace.count(),
        prisma.boardState.count(),
        prisma.agent.count(),
        prisma.channel.count(),
        prisma.vaultItem.count(),
        prisma.mount.count(),
        prisma.run.count(),
        prisma.turn.count(),
        prisma.vote.count(),
        prisma.policy.count(),
      ]);

    expect(workspaceAfterDelete).toBe(0);
    expect(boardStateAfterDelete).toBe(0);
    expect(agentAfterDelete).toBe(0);
    expect(channelAfterDelete).toBe(0);
    expect(vaultAfterDelete).toBe(0);
    expect(mountAfterDelete).toBe(0);
    expect(runAfterDelete).toBe(0);
    expect(turnAfterDelete).toBe(0);
    expect(voteAfterDelete).toBe(0);
    expect(policyAfterDelete).toBe(0);
  });
});
