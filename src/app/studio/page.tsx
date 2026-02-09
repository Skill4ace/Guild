import Link from "next/link";

import { prisma } from "@/lib/db";

import { CreateWorkspaceForm } from "./create-workspace-form";
import { DeleteWorkspaceButton } from "./delete-workspace-button";

export const dynamic = "force-dynamic";

type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  updatedAt: Date;
};

export default async function StudioHomePage() {
  let workspaces: WorkspaceSummary[] = [];
  let dbUnavailable = false;

  try {
    workspaces = await prisma.workspace.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        updatedAt: true,
      },
      take: 50,
    });
  } catch {
    dbUnavailable = true;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <article className="guild-card rounded-3xl p-6 sm:p-8">
        <p className="text-xs font-semibold tracking-[0.2em] text-orange-700">
          WORKSPACES
        </p>
        <h1 className="mt-3 text-3xl font-bold text-slate-950">Select a workspace.</h1>
        <p className="guild-muted mt-2 text-sm sm:text-base">
          Open one to continue.
        </p>

        {dbUnavailable ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Database not reachable. Start services with{" "}
            <code>npm run db:up</code>, then apply migration and seed.
          </div>
        ) : workspaces.length === 0 ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            No workspace yet. Create one from the form.
          </div>
        ) : (
          <ul className="mt-6 grid gap-3">
            {workspaces.map((workspace) => (
              <li
                key={workspace.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-base font-semibold text-slate-900">
                      {workspace.name}
                    </p>
                    <p className="guild-muted text-sm">
                      {workspace.description || "No description"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/studio/${workspace.slug}/board`}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Open
                    </Link>
                    <DeleteWorkspaceButton
                      workspaceSlug={workspace.slug}
                      workspaceName={workspace.name}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <aside className="guild-card rounded-3xl p-6 sm:p-8">
        <h2 className="text-xl font-bold text-slate-950">Create Workspace</h2>
        <p className="guild-muted mt-2 text-sm">Name it and choose a setup.</p>
        <div className="mt-5">
          <CreateWorkspaceForm />
        </div>
      </aside>
    </div>
  );
}
