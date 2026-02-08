import Link from "next/link";

import { requireSessionUser } from "@/lib/auth-server";
import { GuildLogoBadge } from "@/components/guild-logo-badge";
import { prisma } from "@/lib/db";

import { LogoutButton } from "./logout-button";
import { WorkspaceSwitcher } from "./workspace-switcher";

export const dynamic = "force-dynamic";

export default async function StudioLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSessionUser();

  let workspaces: Array<{ slug: string; name: string }> = [];
  let workspaceError: string | null = null;

  try {
    workspaces = await prisma.workspace.findMany({
      orderBy: { updatedAt: "desc" },
      select: { slug: true, name: true },
      take: 50,
    });
  } catch {
    workspaceError = "Database unavailable. Start Postgres to load workspaces.";
  }

  return (
    <div className="min-h-screen px-5 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="guild-card rounded-2xl px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Link href="/studio" aria-label="Go to studio home">
                <GuildLogoBadge />
              </Link>
              <div>
                <p className="text-lg font-bold text-slate-950">Guild Studio</p>
                <p className="guild-muted text-xs">
                  Signed in as {user.name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <WorkspaceSwitcher workspaces={workspaces} />
              <LogoutButton />
            </div>
          </div>

          {workspaceError ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {workspaceError}
            </p>
          ) : null}
        </header>

        <section>{children}</section>
      </div>
    </div>
  );
}
