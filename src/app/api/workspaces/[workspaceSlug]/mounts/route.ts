import { MountAuditAction } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import {
  serializeMount,
  serializeMountAuditEntry,
  validateMountCreateInput,
} from "@/lib/mount-manager";
import { parseVaultTags } from "@/lib/vault-shared";

type RouteContext = {
  params: Promise<{ workspaceSlug: string }>;
};

function toPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function dbFailureResponse(error: unknown, action: "load" | "create") {
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
    { error: `Failed to ${action} mounts.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
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

    const [vaultItems, agents, channels, runs, mounts, audit] = await Promise.all([
      prisma.vaultItem.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          fileName: true,
          mimeType: true,
          byteSize: true,
          tags: true,
        },
        take: 200,
      }),
      prisma.agent.findMany({
        where: { workspaceId: workspace.id, boardNodeId: { not: null } },
        orderBy: [{ authorityWeight: "desc" }, { updatedAt: "desc" }],
        select: { id: true, name: true },
        take: 200,
      }),
      prisma.channel.findMany({
        where: { workspaceId: workspace.id, boardEdgeId: { not: null } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true },
        take: 200,
      }),
      prisma.run.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true, name: true, status: true, template: true },
        take: 200,
      }),
      prisma.mount.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          scope: true,
          createdAt: true,
          updatedAt: true,
          vaultItem: {
            select: {
              id: true,
              name: true,
              fileName: true,
              mimeType: true,
              byteSize: true,
              tags: true,
            },
          },
          agent: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true } },
          run: { select: { id: true, name: true } },
        },
        take: 400,
      }),
      prisma.mountAuditEntry.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          mountId: true,
          action: true,
          scope: true,
          vaultItemId: true,
          agentId: true,
          channelId: true,
          runId: true,
          actorName: true,
          createdAt: true,
        },
        take: 200,
      }),
    ]);

    return NextResponse.json({
      workspace,
      options: {
        vaultItems: vaultItems.map((item) => ({
          ...item,
          tags: parseVaultTags(item.tags),
        })),
        agents,
        channels,
        runs,
      },
      mounts: mounts.map((mount) => serializeMount(mount)),
      audit: audit.map((entry) => serializeMountAuditEntry(entry)),
    });
  } catch (error) {
    return dbFailureResponse(error, "load");
  }
}

type CreateMountBody = {
  vaultItemId?: unknown;
  scope?: unknown;
  agentId?: unknown;
  channelId?: unknown;
  runId?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workspaceSlug } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    let body: CreateMountBody;

    try {
      body = (await request.json()) as CreateMountBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid request body. Expected JSON." },
        { status: 400 },
      );
    }

    const validation = validateMountCreateInput(body);

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { vaultItemId, target } = validation.value;

    const [vaultItem, agent, channel, run] = await Promise.all([
      prisma.vaultItem.findFirst({
        where: { id: vaultItemId, workspaceId: workspace.id },
        select: { id: true },
      }),
      target.scope === "AGENT" && target.agentId
        ? prisma.agent.findFirst({
            where: { id: target.agentId, workspaceId: workspace.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      target.scope === "CHANNEL" && target.channelId
        ? prisma.channel.findFirst({
            where: { id: target.channelId, workspaceId: workspace.id },
            select: { id: true },
          })
        : Promise.resolve(null),
      target.scope === "RUN" && target.runId
        ? prisma.run.findFirst({
            where: { id: target.runId, workspaceId: workspace.id },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!vaultItem) {
      return NextResponse.json(
        { error: "Selected vault item does not exist in this workspace." },
        { status: 400 },
      );
    }

    if (target.scope === "AGENT" && !agent) {
      return NextResponse.json(
        { error: "Selected agent does not exist in this workspace." },
        { status: 400 },
      );
    }

    if (target.scope === "CHANNEL" && !channel) {
      return NextResponse.json(
        { error: "Selected channel does not exist in this workspace." },
        { status: 400 },
      );
    }

    if (target.scope === "RUN" && !run) {
      return NextResponse.json(
        { error: "Selected run does not exist in this workspace." },
        { status: 400 },
      );
    }

    const duplicate = await prisma.mount.findFirst({
      where: {
        workspaceId: workspace.id,
        vaultItemId,
        scope: target.scope,
        agentId: target.scope === "AGENT" ? target.agentId : null,
        channelId: target.scope === "CHANNEL" ? target.channelId : null,
        runId: target.scope === "RUN" ? target.runId : null,
      },
      select: { id: true },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "This mount already exists." },
        { status: 409 },
      );
    }

    const mount = await prisma.$transaction(async (tx) => {
      const created = await tx.mount.create({
        data: {
          workspaceId: workspace.id,
          vaultItemId,
          scope: target.scope,
          agentId: target.agentId,
          channelId: target.channelId,
          runId: target.runId,
        },
        select: {
          id: true,
          scope: true,
          createdAt: true,
          updatedAt: true,
          vaultItem: {
            select: {
              id: true,
              name: true,
              fileName: true,
              mimeType: true,
              byteSize: true,
              tags: true,
            },
          },
          agent: { select: { id: true, name: true } },
          channel: { select: { id: true, name: true } },
          run: { select: { id: true, name: true } },
        },
      });

      await tx.mountAuditEntry.create({
        data: {
          workspaceId: workspace.id,
          mountId: created.id,
          action: MountAuditAction.CREATED,
          scope: target.scope,
          vaultItemId,
          agentId: target.agentId,
          channelId: target.channelId,
          runId: target.runId,
          actorName: user.name,
        },
      });

      return created;
    });

    return NextResponse.json(
      { mount: serializeMount(mount) },
      { status: 201 },
    );
  } catch (error) {
    return dbFailureResponse(error, "create");
  }
}
