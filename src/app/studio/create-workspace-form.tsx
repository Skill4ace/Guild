"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type CreateWorkspaceResponse = {
  workspace?: {
    slug: string;
  };
  error?: string;
};

type WorkspaceTemplateOption = {
  value: "auto" | "blank" | "debate" | "org" | "game" | "build";
  label: string;
  hint: string;
};

const WORKSPACE_TEMPLATE_OPTIONS: WorkspaceTemplateOption[] = [
  {
    value: "auto",
    label: "Auto (recommended)",
    hint: "Infer from your goal.",
  },
  {
    value: "blank",
    label: "Blank board",
    hint: "Start from scratch.",
  },
  {
    value: "debate",
    label: "Debate template",
    hint: "Two sides + mediator.",
  },
  {
    value: "org",
    label: "Org template",
    hint: "Hierarchy workflow.",
  },
  {
    value: "game",
    label: "Game template",
    hint: "Dealer, players, referee.",
  },
  {
    value: "build",
    label: "Build template",
    hint: "General starter graph.",
  },
];

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intent, setIntent] = useState("");
  const [templateKey, setTemplateKey] = useState<
    WorkspaceTemplateOption["value"]
  >("auto");
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
        body: JSON.stringify({ name, description, intent, templateKey }),
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
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold tracking-wide text-slate-600">
            Workspace name
          </label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Product Council"
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            minLength={2}
            maxLength={80}
            required
          />
        </div>

        <div>
          <label className="text-xs font-semibold tracking-wide text-slate-600">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Decision team for launch readiness."
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            maxLength={200}
          />
        </div>

        <div>
          <label className="text-xs font-semibold tracking-wide text-slate-600">
            Goal (optional)
          </label>
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Describe what this workspace should accomplish."
            className="mt-1.5 h-16 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            maxLength={500}
          />
        </div>
      </div>

      <div className="pt-1">
        <label className="text-xs font-semibold tracking-wide text-slate-600">
          Board setup
        </label>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WORKSPACE_TEMPLATE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-xl border px-3 py-2 text-sm transition ${
                templateKey === option.value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
              }`}
            >
              <input
                type="radio"
                name="workspace-template"
                value={option.value}
                checked={templateKey === option.value}
                onChange={() => setTemplateKey(option.value)}
                className="sr-only"
              />
              <span className="block font-semibold">{option.label}</span>
              <span
                className={`mt-0.5 block text-xs ${
                  templateKey === option.value
                    ? "text-slate-200"
                    : "text-slate-500"
                }`}
              >
                {option.hint}
              </span>
            </label>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? "Creating..." : "Create workspace"}
      </button>
    </form>
  );
}
