import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import { readVaultBuffer } from "@/lib/vault-storage";

type RouteContext = {
  params: Promise<{ workspaceSlug: string; vaultItemId: string }>;
};

function safeDownloadName(fileName: string): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "vault-file";
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT";
}

export async function GET(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceSlug, vaultItemId } = await context.params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const item = await prisma.vaultItem.findFirst({
    where: {
      id: vaultItemId,
      workspaceId: workspace.id,
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      storageKey: true,
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Vault item not found" }, { status: 404 });
  }

  try {
    const requestUrl = new URL(request.url);
    const inline = requestUrl.searchParams.get("inline") === "1";
    const fileBuffer = await readVaultBuffer(item.storageKey);
    const fileBody = new Uint8Array(fileBuffer);
    const fallbackName = safeDownloadName(item.fileName);

    return new Response(fileBody, {
      status: 200,
      headers: {
        "Content-Type": item.mimeType || "application/octet-stream",
        "Content-Length": String(fileBody.byteLength),
        "Content-Disposition": inline
          ? `inline; filename=\"${fallbackName}\"; filename*=UTF-8''${encodeURIComponent(item.fileName)}`
          : `attachment; filename=\"${fallbackName}\"; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return NextResponse.json(
        { error: "Stored file is missing. Re-upload this item." },
        { status: 404 },
      );
    }

    return NextResponse.json({ error: "Failed to retrieve vault file." }, { status: 500 });
  }
}
