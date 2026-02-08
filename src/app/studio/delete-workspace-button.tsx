"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type DeleteWorkspaceButtonProps = {
  workspaceSlug: string;
  workspaceName: string;
  className?: string;
};

type DeleteWorkspaceResponse = {
  deleted?: boolean;
  error?: string;
};

export function DeleteWorkspaceButton({
  workspaceSlug,
  workspaceName,
  className,
}: DeleteWorkspaceButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete workspace "${workspaceName}"? This removes runs, board, vault items, mounts, and policies.`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as DeleteWorkspaceResponse;

      if (!response.ok || payload.deleted !== true) {
        setError(payload.error ?? "Failed to delete workspace.");
        return;
      }

      if (pathname.startsWith(`/studio/${workspaceSlug}`)) {
        router.push("/studio");
      }
      router.refresh();
    } catch {
      setError("Network error while deleting workspace.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={isDeleting}
        className={
          className ??
          "rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {isDeleting ? "Deleting..." : "Delete"}
      </button>
      {error ? <p className="text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
