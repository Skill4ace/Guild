import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import { deleteVaultBuffer } from "@/lib/vault-storage";

type RouteContext = {
  params: Promise<{ workspaceSlug: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = getSessionUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceSlug } = await context.params;
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, slug: true, name: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  const vaultItems = await prisma.vaultItem.findMany({
    where: { workspaceId: workspace.id },
    select: { storageKey: true },
    take: 2000,
  });

  await prisma.workspace.delete({
    where: { id: workspace.id },
  });

  await Promise.allSettled(
    vaultItems.map((item) => deleteVaultBuffer(item.storageKey)),
  );

  return NextResponse.json({
    deleted: true,
    workspace: {
      slug: workspace.slug,
      name: workspace.name,
    },
  });
}
