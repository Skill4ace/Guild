import {
  MountAuditAction,
  MountScope,
  PolicyKind,
  PolicyScope,
  Prisma,
  PrismaClient,
  RunStatus,
  RunTemplate,
  VoteStatus,
} from "@prisma/client";

import { syncWorkspaceAgentsFromBoard } from "../src/lib/agent-config";
import { syncWorkspaceChannelsFromBoard } from "../src/lib/channel-config";
import { getTemplateDefinition, type TemplateKey } from "../src/lib/template-library";
import { createVaultStorageKey } from "../src/lib/vault";
import { deleteVaultBuffer, writeVaultBuffer } from "../src/lib/vault-storage";

const prisma = new PrismaClient();

type AgentTools = {
  googleSearchEnabled: boolean;
  codeExecutionEnabled: boolean;
  imageGenerationEnabled: boolean;
};

type AgentToolsOverride = Partial<AgentTools>;

type VaultSeedItem = {
  key: string;
  name: string;
  fileName: string;
  mimeType: string;
  tags: string[];
  content: Uint8Array;
};

type SeedMount =
  | {
      scope: "RUN";
      vaultKey: string;
    }
  | {
      scope: "AGENT";
      vaultKey: string;
      boardNodeId: string;
    }
  | {
      scope: "CHANNEL";
      vaultKey: string;
      boardEdgeId: string;
    };

type WorkspaceSeedScenario = {
  slug: string;
  name: string;
  description: string;
  templateKey: TemplateKey;
  objective: string;
  runName: string;
  toolByNodeId: Record<string, AgentToolsOverride>;
  vaultItems: VaultSeedItem[];
  mounts: SeedMount[];
};

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function textFile(content: string): Uint8Array {
  return new Uint8Array(Buffer.from(content, "utf8"));
}

function hexFile(content: string): Uint8Array {
  return new Uint8Array(Buffer.from(content, "hex"));
}

function base64File(content: string): Uint8Array {
  return new Uint8Array(Buffer.from(content, "base64"));
}

function toRunTemplate(template: "DEBATE" | "ORG" | "GAME" | "CUSTOM"): RunTemplate {
  if (template === "DEBATE") return RunTemplate.DEBATE;
  if (template === "ORG") return RunTemplate.ORG;
  if (template === "GAME") return RunTemplate.GAME;
  return RunTemplate.CUSTOM;
}

function mergeAgentTools(current: unknown, override?: AgentToolsOverride): AgentTools {
  const existing =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};

  return {
    googleSearchEnabled:
      override?.googleSearchEnabled ??
      (typeof existing.googleSearchEnabled === "boolean"
        ? existing.googleSearchEnabled
        : false),
    codeExecutionEnabled:
      override?.codeExecutionEnabled ??
      (typeof existing.codeExecutionEnabled === "boolean"
        ? existing.codeExecutionEnabled
        : false),
    imageGenerationEnabled:
      override?.imageGenerationEnabled ??
      (typeof existing.imageGenerationEnabled === "boolean"
        ? existing.imageGenerationEnabled
        : false),
  };
}

async function createVaultItem(input: {
  workspaceId: string;
  scenarioSlug: string;
  item: VaultSeedItem;
}) {
  const storageKey = createVaultStorageKey(input.workspaceId, input.item.fileName);
  await writeVaultBuffer(storageKey, input.item.content);

  try {
    return await prisma.vaultItem.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.item.name,
        fileName: input.item.fileName,
        mimeType: input.item.mimeType,
        byteSize: input.item.content.byteLength,
        storageKey,
        tags: toInputJsonValue(input.item.tags),
        metadata: toInputJsonValue({
          seeded: true,
          scenarioSlug: input.scenarioSlug,
          vaultKey: input.item.key,
        }),
      },
      select: {
        id: true,
      },
    });
  } catch (error) {
    await deleteVaultBuffer(storageKey);
    throw error;
  }
}

async function createMountWithAudit(input: {
  workspaceId: string;
  vaultItemId: string;
  scope: MountScope;
  agentId: string | null;
  channelId: string | null;
  runId: string | null;
}) {
  const mount = await prisma.mount.create({
    data: {
      workspaceId: input.workspaceId,
      vaultItemId: input.vaultItemId,
      scope: input.scope,
      agentId: input.agentId,
      channelId: input.channelId,
      runId: input.runId,
    },
    select: {
      id: true,
    },
  });

  await prisma.mountAuditEntry.create({
    data: {
      workspaceId: input.workspaceId,
      mountId: mount.id,
      action: MountAuditAction.CREATED,
      scope: input.scope,
      vaultItemId: input.vaultItemId,
      agentId: input.agentId,
      channelId: input.channelId,
      runId: input.runId,
      actorName: "seed",
    },
  });
}

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAgH/i+2kGQAAAABJRU5ErkJggg==";

const SCENARIOS: WorkspaceSeedScenario[] = [
  {
    slug: "debate-research-lab",
    name: "Debate Research Lab",
    description: "Two-sided argumentation with grounded search and mediation.",
    templateKey: "debate",
    objective:
      "Decide whether Guild should prioritize enterprise onboarding or creator growth this quarter.",
    runName: "Debate: Prioritization Decision",
    toolByNodeId: {
      "debate-side-a": { googleSearchEnabled: true },
      "debate-side-b": { googleSearchEnabled: true },
      "debate-mediator": {
        googleSearchEnabled: true,
        codeExecutionEnabled: true,
      },
    },
    vaultItems: [
      {
        key: "market-signals",
        name: "Market Signals",
        fileName: "market-signals-q1.csv",
        mimeType: "text/csv",
        tags: ["data", "examples"],
        content: textFile(
          "segment,retention,ltv\nenterprise,0.79,4200\ncreator,0.54,1200\nconsumer,0.42,650\n",
        ),
      },
      {
        key: "compliance-memo",
        name: "Compliance Memo",
        fileName: "compliance-memo.md",
        mimeType: "text/markdown",
        tags: ["rules"],
        content: textFile(
          "# Compliance Notes\n- Enterprise procurement requires SOC2 update in 60 days.\n- Creator flow has lower regulatory overhead but higher abuse risk.\n",
        ),
      },
      {
        key: "research-notes",
        name: "User Research Notes",
        fileName: "user-research-notes.txt",
        mimeType: "text/plain",
        tags: ["examples", "data"],
        content: textFile(
          "Interview highlights:\n1) Enterprise teams want approval workflows.\n2) Creators want faster publishing and analytics clarity.\n",
        ),
      },
      {
        key: "risk-matrix",
        name: "Risk Matrix",
        fileName: "risk-matrix.json",
        mimeType: "application/json",
        tags: ["rules", "data"],
        content: textFile(
          JSON.stringify(
            {
              enterprise: {
                executionRisk: "medium",
                complianceRisk: "high",
                revenuePotential: "high",
              },
              creator: {
                executionRisk: "low",
                complianceRisk: "medium",
                revenuePotential: "medium",
              },
            },
            null,
            2,
          ),
        ),
      },
    ],
    mounts: [
      { scope: "RUN", vaultKey: "market-signals" },
      {
        scope: "AGENT",
        boardNodeId: "debate-side-a",
        vaultKey: "research-notes",
      },
      {
        scope: "AGENT",
        boardNodeId: "debate-side-b",
        vaultKey: "compliance-memo",
      },
      {
        scope: "CHANNEL",
        boardEdgeId: "debate-e1",
        vaultKey: "risk-matrix",
      },
    ],
  },
  {
    slug: "engineering-incident-lab",
    name: "Engineering Incident Lab",
    description: "Org workflow for incident triage and mitigation decisions.",
    templateKey: "org",
    objective:
      "Triage a production latency incident, propose a fix plan, and choose the safest release path.",
    runName: "Org: Incident Triage",
    toolByNodeId: {
      "org-director": {
        googleSearchEnabled: true,
        codeExecutionEnabled: true,
      },
      "org-product": {
        codeExecutionEnabled: true,
      },
      "org-risk": {
        googleSearchEnabled: true,
      },
    },
    vaultItems: [
      {
        key: "incident-log",
        name: "Incident Log",
        fileName: "incident-log.csv",
        mimeType: "text/csv",
        tags: ["data"],
        content: textFile(
          "timestamp,route,p95_ms,error_rate\n09:00,/runs,3800,0.034\n09:05,/runs,4100,0.041\n09:10,/board,2100,0.012\n",
        ),
      },
      {
        key: "service-map",
        name: "Service Dependency Map",
        fileName: "service-map.md",
        mimeType: "text/markdown",
        tags: ["rules", "examples"],
        content: textFile(
          "# Dependencies\n- API -> Postgres\n- API -> Gemini\n- Scheduler worker -> Redis\n",
        ),
      },
      {
        key: "trace-dump",
        name: "Trace Sample",
        fileName: "trace-sample.json",
        mimeType: "application/json",
        tags: ["data"],
        content: textFile(
          JSON.stringify(
            {
              spans: [
                { name: "db.query", durationMs: 740 },
                { name: "gemini.request", durationMs: 3200 },
                { name: "scheduler.persist", durationMs: 180 },
              ],
            },
            null,
            2,
          ),
        ),
      },
      {
        key: "rollback-runbook",
        name: "Rollback Runbook",
        fileName: "rollback-runbook.md",
        mimeType: "text/markdown",
        tags: ["rules"],
        content: textFile(
          "# Rollback Procedure\n1. Drain queue writes.\n2. Revert deployment to previous stable image.\n3. Replay queued runs from checkpoint.\n",
        ),
      },
    ],
    mounts: [
      { scope: "RUN", vaultKey: "incident-log" },
      {
        scope: "AGENT",
        boardNodeId: "org-product",
        vaultKey: "trace-dump",
      },
      {
        scope: "AGENT",
        boardNodeId: "org-risk",
        vaultKey: "rollback-runbook",
      },
      {
        scope: "CHANNEL",
        boardEdgeId: "org-e7",
        vaultKey: "service-map",
      },
    ],
  },
  {
    slug: "creative-campaign-lab",
    name: "Creative Campaign Lab",
    description: "Custom build workflow with image output artifacts.",
    templateKey: "build",
    objective:
      "Create a launch campaign plan, generate concept visuals, and produce an execution checklist.",
    runName: "Build: Campaign Strategy",
    toolByNodeId: {
      "build-lead": { googleSearchEnabled: true },
      "build-planner": {
        googleSearchEnabled: true,
        codeExecutionEnabled: true,
      },
      "build-operator": {
        imageGenerationEnabled: true,
      },
    },
    vaultItems: [
      {
        key: "brand-guide",
        name: "Brand Guide",
        fileName: "brand-guide.md",
        mimeType: "text/markdown",
        tags: ["rules", "assets"],
        content: textFile(
          "# Brand Guide\n- Tone: confident, practical, human.\n- Palette: navy, sky, mint.\n- Avoid cluttered layouts.\n",
        ),
      },
      {
        key: "campaign-brief",
        name: "Campaign Brief",
        fileName: "campaign-brief.txt",
        mimeType: "text/plain",
        tags: ["examples"],
        content: textFile(
          "Goal: increase team signups by 20% in 8 weeks.\nAudience: startup operators and PM leaders.\n",
        ),
      },
      {
        key: "audience-data",
        name: "Audience Segments",
        fileName: "audience-segments.csv",
        mimeType: "text/csv",
        tags: ["data"],
        content: textFile(
          "segment,size,primary_need\nstartup_ops,4200,governance\nproduct_leads,3100,execution clarity\n",
        ),
      },
      {
        key: "style-reference",
        name: "Style Reference",
        fileName: "style-reference.png",
        mimeType: "image/png",
        tags: ["assets"],
        content: base64File(TINY_PNG),
      },
    ],
    mounts: [
      { scope: "RUN", vaultKey: "campaign-brief" },
      {
        scope: "AGENT",
        boardNodeId: "build-lead",
        vaultKey: "brand-guide",
      },
      {
        scope: "AGENT",
        boardNodeId: "build-planner",
        vaultKey: "audience-data",
      },
      {
        scope: "CHANNEL",
        boardEdgeId: "build-e2",
        vaultKey: "style-reference",
      },
    ],
  },
  {
    slug: "game-strategy-sandbox",
    name: "Game Strategy Sandbox",
    description: "Poker-style simulation with referee validation and table state assets.",
    templateKey: "game",
    objective:
      "Simulate one poker-style round and validate decision integrity across private/public state transitions.",
    runName: "Game: Round Simulation",
    toolByNodeId: {
      "game-dealer": { codeExecutionEnabled: true },
      "game-referee": {
        codeExecutionEnabled: true,
      },
    },
    vaultItems: [
      {
        key: "poker-rules",
        name: "Poker Rules",
        fileName: "poker-rules.md",
        mimeType: "text/markdown",
        tags: ["rules"],
        content: textFile(
          "# Table Rules\n- No invalid raises.\n- Referee validates final pot and action ordering.\n",
        ),
      },
      {
        key: "hand-history",
        name: "Hand History",
        fileName: "hand-history.csv",
        mimeType: "text/csv",
        tags: ["data"],
        content: textFile(
          "hand,player_a,player_b,action_a,action_b\n1,As Ks,Qh Jh,raise_50,call_50\n",
        ),
      },
      {
        key: "table-state",
        name: "Table State",
        fileName: "table-state.json",
        mimeType: "application/json",
        tags: ["data"],
        content: textFile(
          JSON.stringify(
            {
              blinds: { small: 5, big: 10 },
              stack: { playerA: 950, playerB: 960 },
              board: ["Qs", "Jh", "2d"],
            },
            null,
            2,
          ),
        ),
      },
      {
        key: "table-cam",
        name: "Table Cam Clip",
        fileName: "table-cam.mp4",
        mimeType: "video/mp4",
        tags: ["assets"],
        content: hexFile("00000020667479706D703432000000006D70343269736F6D"),
      },
    ],
    mounts: [
      { scope: "RUN", vaultKey: "poker-rules" },
      {
        scope: "AGENT",
        boardNodeId: "game-dealer",
        vaultKey: "table-state",
      },
      {
        scope: "AGENT",
        boardNodeId: "game-referee",
        vaultKey: "hand-history",
      },
      {
        scope: "CHANNEL",
        boardEdgeId: "game-e5",
        vaultKey: "table-cam",
      },
    ],
  },
];

async function seedScenario(scenario: WorkspaceSeedScenario) {
  const template = getTemplateDefinition(scenario.templateKey);

  const seededNodes = template.board.nodes.map((node) => {
    const data = node.data;

    return {
      ...node,
      data: {
        ...data,
        tools: mergeAgentTools(data.tools, scenario.toolByNodeId[node.id]),
      },
    };
  });

  const seededEdges = template.board.edges.map((edge) => ({ ...edge }));

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: {
        name: scenario.name,
        slug: scenario.slug,
        description: scenario.description,
      },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    await tx.boardState.create({
      data: {
        workspaceId: created.id,
        nodes: toInputJsonValue(seededNodes),
        edges: toInputJsonValue(seededEdges),
        viewport: toInputJsonValue({
          ...template.board.viewport,
          objective: scenario.objective,
        }),
      },
    });

    await syncWorkspaceAgentsFromBoard(tx, created.id, seededNodes);
    await syncWorkspaceChannelsFromBoard(tx, created.id, seededEdges);

    return created;
  });

  const [agents, channels] = await Promise.all([
    prisma.agent.findMany({
      where: { workspaceId: workspace.id, boardNodeId: { not: null } },
      select: { id: true, boardNodeId: true },
    }),
    prisma.channel.findMany({
      where: { workspaceId: workspace.id, boardEdgeId: { not: null } },
      select: { id: true, boardEdgeId: true },
    }),
  ]);

  const agentIdByNodeId = new Map<string, string>();
  for (const agent of agents) {
    if (agent.boardNodeId) {
      agentIdByNodeId.set(agent.boardNodeId, agent.id);
    }
  }

  const channelIdByEdgeId = new Map<string, string>();
  for (const channel of channels) {
    if (channel.boardEdgeId) {
      channelIdByEdgeId.set(channel.boardEdgeId, channel.id);
    }
  }

  const run = await prisma.run.create({
    data: {
      workspaceId: workspace.id,
      name: scenario.runName,
      template: toRunTemplate(template.runTemplate),
      status: RunStatus.DRAFT,
      boardSnapshot: toInputJsonValue({
        nodes: seededNodes,
        edges: seededEdges,
      }),
      state: toInputJsonValue({
        runObjective: scenario.objective,
        schedulerRuntime: {
          maxRetries: 2,
          turnTimeoutMs: 30000,
          transientFailureSequences: [],
          timeoutFailureSequences: [],
        },
        schedulerCheckpoint: {
          lastTurnId: null,
          lastSequence: 0,
          queueDepth: 0,
          completedTurns: 0,
          blockedTurns: 0,
          skippedTurns: 0,
          retriesUsed: 0,
          processedAttempts: 0,
          note: "Draft created from seed scenario.",
          updatedAt: new Date().toISOString(),
        },
      }),
    },
    select: { id: true },
  });

  if (template.policies.length > 0) {
    await prisma.policy.createMany({
      data: template.policies.map((policy) => ({
        workspaceId: workspace.id,
        runId: run.id,
        name: policy.name,
        kind: policy.kind as PolicyKind,
        scope: PolicyScope.RUN,
        config: toInputJsonValue(policy.config),
      })),
    });
  }

  if (template.initialVote) {
    await prisma.vote.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        question: template.initialVote.question,
        status: VoteStatus.OPEN,
        quorum: template.initialVote.quorum,
        threshold: template.initialVote.threshold,
        options: toInputJsonValue(template.initialVote.options),
        weights: toInputJsonValue({}),
        ballots: toInputJsonValue({}),
      },
    });
  }

  const vaultItemIdByKey = new Map<string, string>();
  for (const item of scenario.vaultItems) {
    const created = await createVaultItem({
      workspaceId: workspace.id,
      scenarioSlug: scenario.slug,
      item,
    });
    vaultItemIdByKey.set(item.key, created.id);
  }

  for (const mount of scenario.mounts) {
    const vaultItemId = vaultItemIdByKey.get(mount.vaultKey);
    if (!vaultItemId) {
      throw new Error(
        `Seed mount references unknown vault key \`${mount.vaultKey}\` in ${scenario.slug}.`,
      );
    }

    if (mount.scope === "RUN") {
      await createMountWithAudit({
        workspaceId: workspace.id,
        vaultItemId,
        scope: MountScope.RUN,
        agentId: null,
        channelId: null,
        runId: run.id,
      });
      continue;
    }

    if (mount.scope === "AGENT") {
      const agentId = agentIdByNodeId.get(mount.boardNodeId);
      if (!agentId) {
        throw new Error(
          `Seed mount references unknown board node \`${mount.boardNodeId}\` in ${scenario.slug}.`,
        );
      }

      await createMountWithAudit({
        workspaceId: workspace.id,
        vaultItemId,
        scope: MountScope.AGENT,
        agentId,
        channelId: null,
        runId: null,
      });
      continue;
    }

    const channelId = channelIdByEdgeId.get(mount.boardEdgeId);
    if (!channelId) {
      throw new Error(
        `Seed mount references unknown board edge \`${mount.boardEdgeId}\` in ${scenario.slug}.`,
      );
    }

    await createMountWithAudit({
      workspaceId: workspace.id,
      vaultItemId,
      scope: MountScope.CHANNEL,
      agentId: null,
      channelId,
      runId: null,
    });
  }

  const [agentCount, channelCount, vaultCount, mountCount] = await Promise.all([
    prisma.agent.count({ where: { workspaceId: workspace.id } }),
    prisma.channel.count({ where: { workspaceId: workspace.id } }),
    prisma.vaultItem.count({ where: { workspaceId: workspace.id } }),
    prisma.mount.count({ where: { workspaceId: workspace.id } }),
  ]);

  return {
    slug: workspace.slug,
    name: workspace.name,
    agents: agentCount,
    channels: channelCount,
    vaultItems: vaultCount,
    mounts: mountCount,
  };
}

async function main() {
  const cleanupSlugs = [
    ...SCENARIOS.map((scenario) => scenario.slug),
    "guild-starter",
    "guild-demo",
  ];

  await prisma.workspace.deleteMany({
    where: {
      slug: {
        in: cleanupSlugs,
      },
    },
  });

  const summaries = [] as Array<{
    slug: string;
    name: string;
    agents: number;
    channels: number;
    vaultItems: number;
    mounts: number;
  }>;

  for (const scenario of SCENARIOS) {
    const summary = await seedScenario(scenario);
    summaries.push(summary);
  }

  console.log("Seed completed", {
    workspaceCount: summaries.length,
    workspaces: summaries,
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
