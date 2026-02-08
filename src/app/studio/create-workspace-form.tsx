"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type CreateWorkspaceResponse = {
  workspace?: {
    slug: string;
  };
  error?: string;
};

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      const data = (await response.json()) as CreateWorkspaceResponse;

      if (!response.ok || !data.workspace) {
        setError(data.error ?? "Failed to create workspace.");
        return;
      }

      router.push(`/studio/${data.workspace.slug}/board`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-semibold tracking-wide text-slate-600">
          Workspace name
        </label>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Product Council"
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          minLength={2}
          maxLength={80}
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold tracking-wide text-slate-600">
          Description (optional)
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Decision team for launch readiness."
          className="mt-1 h-24 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          maxLength={200}
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? "Creating..." : "Create workspace"}
      </button>
    </form>
  );
}
