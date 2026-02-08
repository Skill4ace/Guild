import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import {
  createEmptyBoardDocument,
  sanitizeBoardDocument,
} from "@/lib/board-state";
import { prisma } from "@/lib/db";
import { syncWorkspaceAgentsFromBoard } from "@/lib/agent-config";
import { syncWorkspaceChannelsFromBoard } from "@/lib/channel-config";

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

function dbFailureResponse(error: unknown, action: "load" | "save") {
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

  if (code === "P2002") {
    return NextResponse.json(
      {
        error:
          "Duplicate board IDs detected. Reload the board and try saving again.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { error: `Failed to ${action} board state.${code ? ` (${code})` : ""}` },
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

    const boardState = await prisma.boardState.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        nodes: true,
        edges: true,
        viewport: true,
        updatedAt: true,
      },
    });

    const board = sanitizeBoardDocument({
      nodes: boardState?.nodes ?? [],
      edges: boardState?.edges ?? [],
      viewport: boardState?.viewport ?? undefined,
    });

    return NextResponse.json({
      workspace,
      board,
      updatedAt: boardState?.updatedAt ?? null,
    });
  } catch (error) {
    return dbFailureResponse(error, "load");
  }
}

export async function PUT(request: Request, context: RouteContext) {
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

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body. Expected JSON." },
        { status: 400 },
      );
    }

    const board = sanitizeBoardDocument(payload);
    const safeBoard = board.nodes.length > 0 || board.edges.length > 0
      ? board
      : createEmptyBoardDocument();
    const nodesJson = JSON.parse(
      JSON.stringify(safeBoard.nodes),
    ) as Prisma.InputJsonValue;
    const edgesJson = JSON.parse(
      JSON.stringify(safeBoard.edges),
    ) as Prisma.InputJsonValue;
    const viewportJson = JSON.parse(
      JSON.stringify({
        ...safeBoard.viewport,
        objective: safeBoard.objective,
      }),
    ) as Prisma.InputJsonValue;

    const saved = await prisma.$transaction(async (tx) => {
      const boardState = await tx.boardState.upsert({
        where: { workspaceId: workspace.id },
        update: {
          nodes: nodesJson,
          edges: edgesJson,
          viewport: viewportJson,
        },
        create: {
          workspaceId: workspace.id,
          nodes: nodesJson,
          edges: edgesJson,
          viewport: viewportJson,
        },
        select: { updatedAt: true },
      });

      await syncWorkspaceAgentsFromBoard(tx, workspace.id, safeBoard.nodes);
      await syncWorkspaceChannelsFromBoard(tx, workspace.id, safeBoard.edges);
      return boardState;
    });

    return NextResponse.json({
      ok: true,
      board: safeBoard,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    return dbFailureResponse(error, "save");
  }
}
