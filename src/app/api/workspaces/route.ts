import { NextResponse } from "next/server";

import { getSessionUserFromRequest } from "@/lib/auth-request";
import { prisma } from "@/lib/db";
import { slugifyWorkspaceName } from "@/lib/slug";

type CreateWorkspaceBody = {
  name?: unknown;
  description?: unknown;
};

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

  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: "Workspace name must be between 2 and 80 characters." },
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

  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug,
      description: description || null,
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

  return NextResponse.json({ workspace }, { status: 201 });
}
