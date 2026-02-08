"use client";

import { usePathname, useRouter } from "next/navigation";

type WorkspaceOption = {
  slug: string;
  name: string;
};

type WorkspaceSwitcherProps = {
  workspaces: WorkspaceOption[];
};

export function WorkspaceSwitcher({ workspaces }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();

  const matched = pathname.match(/^\/studio\/([^/]+)/);
  const activeWorkspaceSlug = matched?.[1] ?? "";
  const value = workspaces.some((ws) => ws.slug === activeWorkspaceSlug)
    ? activeWorkspaceSlug
    : "";

  function handleChange(nextSlug: string) {
    if (!nextSlug) {
      router.push("/studio");
      return;
    }

    router.push(`/studio/${nextSlug}/board`);
  }

  return (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
      <span>Workspace</span>
      <select
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
      >
        <option value="">Select workspace</option>
        {workspaces.map((workspace) => (
          <option key={workspace.slug} value={workspace.slug}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}
