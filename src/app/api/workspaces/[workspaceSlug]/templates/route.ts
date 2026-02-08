import {
  PolicyKind,
  PolicyScope,
  Prisma,
  RunStatus,
  RunTemplate,
  VoteStatus,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { syncWorkspaceAgentsFromBoard } from "@/lib/agent-config";
import { getSessionUserFromRequest } from "@/lib/auth-request";
import { syncWorkspaceChannelsFromBoard } from "@/lib/channel-config";
import { prisma } from "@/lib/db";
import {
  DEFAULT_SCHEDULER_RUNTIME_OPTIONS,
  resolveSchedulerRuntimeOptions,
} from "@/lib/run-scheduler";
import {
  getTemplateDefinition,
  isTemplateKey,
  listTemplateManifests,
  type TemplateDefinition,
} from "@/lib/template-library";

type RouteContext = {
  params: Promise<{ workspaceSlug: string }>;
};

type LaunchTemplateBody = {
  templateKey?: unknown;
  runName?: unknown;
  objective?: unknown;
  runtime?: unknown;
};

function toPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function dbFailureResponse(error: unknown, action: "load" | "launch") {
  const code = toPrismaErrorCode(error);
  const infrastructureCodes = new Set(["P1001"]);
  const schemaMismatchCodes = new Set(["P2021", "P2022"]);

  if (code && infrastructureCodes.has(code)) {
    return NextResponse.json(
      {
        error:
          "Database not ready. Start Postgres, then run `npm run db:migrate:deploy` and `npm run db:seed`.",
      },
      { status: 503 },
    );
  }

  if (code && schemaMismatchCodes.has(code)) {
    return NextResponse.json(
      {
        error:
          "Database schema is behind the app. Run `npm run db:migrate:deploy` then `npm run db:seed`.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: `Failed to ${action} template.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
}

function normalizeRunName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeObjective(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, 400);
  return trimmed.length > 0 ? trimmed : null;
}

function toRunTemplate(value: TemplateDefinition["runTemplate"]): RunTemplate {
  if (value === "DEBATE") return RunTemplate.DEBATE;
  if (value === "ORG") return RunTemplate.ORG;
  if (value === "GAME") return RunTemplate.GAME;
  return RunTemplate.CUSTOM;
}

function toPolicyKind(value: TemplateDefinition["policies"][number]["kind"]): PolicyKind {
  if (value === "APPROVAL") return PolicyKind.APPROVAL;
  if (value === "VETO") return PolicyKind.VETO;
  if (value === "ESCALATION") return PolicyKind.ESCALATION;
  return PolicyKind.CONSENSUS;
}

export async function GET(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workspaceSlug } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json({
      workspace,
      templates: listTemplateManifests(),
    });
  } catch (error) {
    return dbFailureResponse(error, "load");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workspaceSlug } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, slug: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let body: LaunchTemplateBody = {};
    try {
      body = (await request.json()) as LaunchTemplateBody;
    } catch {
      body = {};
    }

    if (!isTemplateKey(body.templateKey)) {
      return NextResponse.json(
        { error: "Invalid template key." },
        { status: 400 },
      );
    }

    const template = getTemplateDefinition(body.templateKey);
    const runtimeOptions = resolveSchedulerRuntimeOptions(
      { schedulerRuntime: DEFAULT_SCHEDULER_RUNTIME_OPTIONS },
      body.runtime as Partial<typeof DEFAULT_SCHEDULER_RUNTIME_OPTIONS>,
    );
    const runName = normalizeRunName(body.runName) ?? "New Run";
    const runObjective = normalizeObjective(body.objective) ?? template.objective;

    const launched = await prisma.$transaction(async (tx) => {
      await tx.boardState.upsert({
        where: { workspaceId: workspace.id },
        update: {
          nodes: JSON.parse(JSON.stringify(template.board.nodes)) as Prisma.InputJsonValue,
          edges: JSON.parse(JSON.stringify(template.board.edges)) as Prisma.InputJsonValue,
          viewport: JSON.parse(
            JSON.stringify({
              ...template.board.viewport,
              objective: runObjective,
            }),
          ) as Prisma.InputJsonValue,
        },
        create: {
          workspaceId: workspace.id,
          nodes: JSON.parse(JSON.stringify(template.board.nodes)) as Prisma.InputJsonValue,
          edges: JSON.parse(JSON.stringify(template.board.edges)) as Prisma.InputJsonValue,
          viewport: JSON.parse(
            JSON.stringify({
              ...template.board.viewport,
              objective: runObjective,
            }),
          ) as Prisma.InputJsonValue,
        },
      });

      await syncWorkspaceAgentsFromBoard(tx, workspace.id, template.board.nodes);
      await syncWorkspaceChannelsFromBoard(tx, workspace.id, template.board.edges);

      const agents = await tx.agent.findMany({
        where: {
          workspaceId: workspace.id,
          boardNodeId: {
            in: template.board.nodes.map((node) => node.id),
          },
        },
        select: {
          id: true,
          boardNodeId: true,
          name: true,
          role: true,
        },
      });
      const channels = await tx.channel.findMany({
        where: {
          workspaceId: workspace.id,
          boardEdgeId: {
            in: template.board.edges.map((edge) => edge.id),
          },
        },
        select: {
          id: true,
          boardEdgeId: true,
          sourceAgentId: true,
          targetAgentId: true,
          name: true,
        },
      });

      const run = await tx.run.create({
        data: {
          workspaceId: workspace.id,
          name: runName,
          template: toRunTemplate(template.runTemplate),
          status: RunStatus.DRAFT,
          boardSnapshot: JSON.parse(
            JSON.stringify({
              nodes: template.board.nodes,
              edges: template.board.edges,
            }),
          ) as Prisma.InputJsonValue,
          state: {
            schedulerRuntime: runtimeOptions,
            schedulerCheckpoint: {
              lastTurnId: null,
              lastSequence: 0,
              queueDepth: 0,
              completedTurns: 0,
              blockedTurns: 0,
              skippedTurns: 0,
              retriesUsed: 0,
              processedAttempts: 0,
              note: `${template.label} template launched and ready for execution.`,
              updatedAt: new Date().toISOString(),
            },
            template: {
              key: template.key,
              label: template.label,
              objective: runObjective,
            },
            runObjective,
          },
        },
        select: {
          id: true,
          name: true,
          status: true,
          template: true,
          createdAt: true,
        },
      });

      if (template.policies.length > 0) {
        await tx.policy.createMany({
          data: template.policies.map((policy) => ({
            workspaceId: workspace.id,
            runId: run.id,
            name: `${template.label} - ${policy.name}`,
            kind: toPolicyKind(policy.kind),
            scope: PolicyScope.RUN,
            isActive: true,
            config: JSON.parse(
              JSON.stringify(policy.config),
            ) as Prisma.InputJsonValue,
          })),
        });
      }

      if (template.initialVote) {
        await tx.vote.create({
          data: {
            workspaceId: workspace.id,
            runId: run.id,
            question: template.initialVote.question,
            status: VoteStatus.OPEN,
            quorum: template.initialVote.quorum,
            threshold: template.initialVote.threshold,
            options: template.initialVote.options,
            ballots: {},
            weights: {},
          },
        });
      }

      return {
        run,
        board: {
          nodeCount: template.board.nodes.length,
          edgeCount: template.board.edges.length,
        },
        agents,
        channels,
      };
    });

    return NextResponse.json(
      {
        template: {
          key: template.key,
          label: template.label,
          objective: runObjective,
        },
        run: launched.run,
        board: launched.board,
        entities: {
          agentCount: launched.agents.length,
          channelCount: launched.channels.length,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return dbFailureResponse(error, "launch");
  }
}
