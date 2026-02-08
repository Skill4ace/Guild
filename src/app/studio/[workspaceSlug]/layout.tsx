import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";

import { DeleteWorkspaceButton } from "../delete-workspace-button";
import { WorkspaceTabs } from "./workspace-tabs";

export const dynamic = "force-dynamic";

type WorkspaceLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}>;

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceSlug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      updatedAt: true,
    },
  });

  if (!workspace) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <header className="guild-card rounded-2xl p-5 sm:p-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-orange-700">
          WORKSPACE
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-950">{workspace.name}</h1>
          <DeleteWorkspaceButton
            workspaceSlug={workspace.slug}
            workspaceName={workspace.name}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <p className="guild-muted mt-1 text-sm">
          {workspace.description || "No description set."}
        </p>

        <div className="mt-4">
          <WorkspaceTabs workspaceSlug={workspace.slug} />
        </div>
      </header>

      <section className="guild-card rounded-2xl p-5 sm:p-6">{children}</section>
    </div>
  );
}
