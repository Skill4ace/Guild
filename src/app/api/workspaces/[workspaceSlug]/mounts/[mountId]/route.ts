import { MountAuditAction } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{ workspaceSlug: string; mountId: string }>;
};

function toPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : null;
}

function dbFailureResponse(error: unknown, action: "remove") {
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
    { error: `Failed to ${action} mount.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { workspaceSlug, mountId } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const mount = await prisma.mount.findFirst({
      where: { id: mountId, workspaceId: workspace.id },
      select: {
        id: true,
        scope: true,
        vaultItemId: true,
        agentId: true,
        channelId: true,
        runId: true,
      },
    });

    if (!mount) {
      return NextResponse.json({ error: "Mount not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mount.delete({ where: { id: mount.id } });

      await tx.mountAuditEntry.create({
        data: {
          workspaceId: workspace.id,
          mountId: mount.id,
          action: MountAuditAction.REMOVED,
          scope: mount.scope,
          vaultItemId: mount.vaultItemId,
          agentId: mount.agentId,
          channelId: mount.channelId,
          runId: mount.runId,
          actorName: user.name,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return dbFailureResponse(error, "remove");
  }
}
