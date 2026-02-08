"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

const tabs = [
  { key: "board", label: "Board" },
  { key: "vault", label: "Vault" },
  { key: "runs", label: "Runs" },
  { key: "templates", label: "Templates" },
] as const;

type WorkspaceTabsProps = {
  workspaceSlug: string;
};

export function WorkspaceTabs({ workspaceSlug }: WorkspaceTabsProps) {
  const segment = useSelectedLayoutSegment() ?? "board";

  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = segment === tab.key;

        return (
          <Link
            key={tab.key}
            href={`/studio/${workspaceSlug}/${tab.key}`}
            className={
              isActive
                ? "rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
