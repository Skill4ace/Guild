import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import {
  createVaultStorageKey,
  parseVaultTags,
  validateVaultUpload,
} from "@/lib/vault";
import { deleteVaultBuffer, writeVaultBuffer } from "@/lib/vault-storage";

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

function dbFailureResponse(error: unknown, action: "load" | "upload") {
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
    { error: `Failed to ${action} vault items.${code ? ` (${code})` : ""}` },
    { status: 500 },
  );
}

function toVaultItemResponse(item: {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  tags: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    name: item.name,
    fileName: item.fileName,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    tags: parseVaultTags(item.tags),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
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

    const items = await prisma.vaultItem.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        fileName: true,
        mimeType: true,
        byteSize: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 200,
    });

    return NextResponse.json({
      workspace,
      items: items.map((item) => toVaultItemResponse(item)),
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

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body. Expected form-data." },
        { status: 400 },
      );
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: "Please choose a file to upload." },
        { status: 400 },
      );
    }

    const rawName = formData.get("name");
    const rawTagEntries = formData.getAll("tags");
    const rawTags = rawTagEntries.length > 0 ? rawTagEntries : formData.get("tags");

    const validation = validateVaultUpload({
      name: rawName,
      tags: rawTags,
      fileName: fileEntry.name,
      mimeType: fileEntry.type,
      byteSize: fileEntry.size,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const bytes = new Uint8Array(await fileEntry.arrayBuffer());
    const storageKey = createVaultStorageKey(workspace.id, validation.value.fileName);

    await writeVaultBuffer(storageKey, bytes);

    try {
      const item = await prisma.vaultItem.create({
        data: {
          workspaceId: workspace.id,
          name: validation.value.name,
          fileName: validation.value.fileName,
          mimeType: validation.value.mimeType,
          byteSize: validation.value.byteSize,
          storageKey,
          tags: validation.value.tags,
          metadata: {
            uploadedByUserId: user.id,
            uploadedByName: user.name,
          },
        },
        select: {
          id: true,
          name: true,
          fileName: true,
          mimeType: true,
          byteSize: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return NextResponse.json({ item: toVaultItemResponse(item) }, { status: 201 });
    } catch (error) {
      await deleteVaultBuffer(storageKey);
      throw error;
    }
  } catch (error) {
    return dbFailureResponse(error, "upload");
  }
}
