import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { syncWorkspaceAgentsFromBoard } from "@/lib/agent-config";
import { sanitizeBoardDocument } from "@/lib/board-state";
import { syncWorkspaceChannelsFromBoard } from "@/lib/channel-config";
import { prisma } from "@/lib/db";
import { slugifyWorkspaceName } from "@/lib/slug";
import {
  getTemplateDefinition,
  isTemplateKey,
  type TemplateKey,
} from "@/lib/template-library";
import {
  generateAutoWorkspaceDraft,
  normalizeWorkspaceIntent,
} from "@/lib/workspace-autobuilder";

type CreateWorkspaceBody = {
  name?: unknown;
  description?: unknown;
  templateKey?: unknown;
  intent?: unknown;
};

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET(request: Request) {
  const user = getSessionUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
    take: 50,
  });

  return NextResponse.json({ workspaces });
}

export async function POST(request: Request) {
  const user = getSessionUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateWorkspaceBody;

  try {
    body = (await request.json()) as CreateWorkspaceBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body. Expected JSON." },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : null;
  const templateKey =
    typeof body.templateKey === "string"
      ? body.templateKey.trim().toLowerCase()
      : body.templateKey;
  const intent = normalizeWorkspaceIntent(body.intent);
  const isAutoSetup = templateKey === "auto";

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: "Workspace name must be between 2 and 80 characters." },
      { status: 400 },
    );
  }

  const autoDraft = isAutoSetup
    ? await generateAutoWorkspaceDraft({
        workspaceName: name,
        workspaceDescription: description,
        intent,
      })
    : null;
  const autoBoardDocument = isAutoSetup ? autoDraft?.draft.boardDocument ?? null : null;
  const setupTemplate: TemplateKey | null =
    templateKey === undefined ||
    templateKey === null ||
    templateKey === "" ||
    templateKey === "blank"
      ? null
      : templateKey === "auto"
        ? autoBoardDocument
          ? null
          : autoDraft?.draft.templateKey ?? "build"
        : isTemplateKey(templateKey)
          ? templateKey
          : null;
  const resolvedDescription =
    description && description.length > 0
      ? description
      : autoDraft?.draft.workspaceDescription ?? null;

  if (
    templateKey !== undefined &&
    templateKey !== null &&
    templateKey !== "" &&
    templateKey !== "blank" &&
    templateKey !== "auto" &&
    !isTemplateKey(templateKey)
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid board setup option. Choose auto, blank, debate, org, game, or build.",
      },
      { status: 400 },
    );
  }

  const baseSlug = slugifyWorkspaceName(name);
  let slug = baseSlug;
  let suffix = 1;

  while (await prisma.workspace.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: {
        name,
        slug,
        description: resolvedDescription,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (autoBoardDocument) {
      const resolvedObjective =
        autoDraft?.draft.boardObjective ?? autoBoardDocument.objective;
      const boardDocument = sanitizeBoardDocument({
        ...autoBoardDocument,
        objective: resolvedObjective,
        viewport: {
          ...autoBoardDocument.viewport,
          objective: resolvedObjective,
        },
      });

      await tx.boardState.create({
        data: {
          workspaceId: created.id,
          nodes: toInputJsonValue(boardDocument.nodes),
          edges: toInputJsonValue(boardDocument.edges),
          viewport: toInputJsonValue({
            ...boardDocument.viewport,
            objective: resolvedObjective,
          }),
        },
      });

      await syncWorkspaceAgentsFromBoard(tx, created.id, boardDocument.nodes);
      await syncWorkspaceChannelsFromBoard(tx, created.id, boardDocument.edges);
    } else if (setupTemplate) {
      const template = getTemplateDefinition(setupTemplate);
      const resolvedObjective = autoDraft?.draft.boardObjective ?? template.objective;

      await tx.boardState.create({
        data: {
          workspaceId: created.id,
          nodes: toInputJsonValue(template.board.nodes),
          edges: toInputJsonValue(template.board.edges),
          viewport: toInputJsonValue({
            ...template.board.viewport,
            objective: resolvedObjective,
          }),
        },
      });

      await syncWorkspaceAgentsFromBoard(tx, created.id, template.board.nodes);
      await syncWorkspaceChannelsFromBoard(tx, created.id, template.board.edges);
    }

    return created;
  });

  return NextResponse.json(
    {
      workspace,
      autoSetup: autoDraft
        ? {
            templateKey: autoDraft.draft.templateKey,
            topology: autoDraft.draft.topology.kind,
            boardObjective: autoDraft.draft.boardObjective,
            source: autoDraft.draft.source,
            telemetry: autoDraft.telemetry,
          }
        : null,
    },
    { status: 201 },
  );
}
