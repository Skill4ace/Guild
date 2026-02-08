"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type TemplateLauncherProps = {
  workspaceSlug: string;
};

type TemplateManifest = {
  key: "debate" | "org" | "game" | "build";
  label: string;
  tagLine: string;
  objective: string;
  runTemplate: "DEBATE" | "ORG" | "GAME" | "CUSTOM";
  agentCount: number;
  channelCount: number;
  orderedChannelCount: number;
  policyCount: number;
  hasInitialVote: boolean;
};

type TemplatesPayload = {
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  templates: TemplateManifest[];
};

type LaunchPayload = {
  template?: {
    key: string;
    label: string;
    objective: string;
  };
  run?: {
    id: string;
    name: string | null;
    status: string;
    template: string;
  };
  entities?: {
    agentCount: number;
    channelCount: number;
  };
  error?: string;
};

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return `${payload.error} [${response.status}]`;
    }
  } catch {
    // Ignore parse failures and fallback to status code.
  }

  return `Request failed [${response.status}]`;
}

export function TemplateLauncher({ workspaceSlug }: TemplateLauncherProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [launchingKey, setLaunchingKey] = useState<string | null>(null);
  const [runName, setRunName] = useState("");
  const [launchObjective, setLaunchObjective] = useState("");
  const [maxRetries, setMaxRetries] = useState(2);
  const [turnTimeoutMs, setTurnTimeoutMs] = useState(30000);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/templates`,
        {
          method: "GET",
        },
      );

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }

      const payload = (await response.json()) as TemplatesPayload;
      setTemplates(payload.templates ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load templates.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function launchTemplate(templateKey: TemplateManifest["key"]) {
    const template = templates.find((entry) => entry.key === templateKey);
    const confirmed = window.confirm(
      `Launch ${template?.label ?? "template"}? This will replace the current board in this workspace.`,
    );
    if (!confirmed) {
      return;
    }

    setLaunchingKey(templateKey);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/templates`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            templateKey,
            runName: runName.trim() || undefined,
            objective: launchObjective.trim() || undefined,
            runtime: {
              maxRetries: Number.isFinite(maxRetries)
                ? Math.max(0, Math.min(5, Math.round(maxRetries)))
                : 2,
              turnTimeoutMs: Number.isFinite(turnTimeoutMs)
                ? Math.max(500, Math.min(60000, Math.round(turnTimeoutMs)))
                : 30000,
            },
          }),
        },
      );

      const payload = (await response.json()) as LaunchPayload;
      if (!response.ok) {
        throw new Error(payload.error || `Template launch failed [${response.status}]`);
      }

      setMessage(
        `${payload.template?.label ?? "Template"} launched. ` +
          `${payload.entities?.agentCount ?? 0} agents and ${payload.entities?.channelCount ?? 0} channels are ready.`,
      );
      setRunName("");
      setLaunchObjective("");
      router.refresh();
    } catch (launchError) {
      setError(
        launchError instanceof Error
          ? launchError.message
          : "Failed to launch template.",
      );
    } finally {
      setLaunchingKey(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Template Launcher</h3>
        <p className="mt-1 text-xs text-slate-500">
          Launch a full board scaffold with governance and a ready draft run.
        </p>

        <label className="mt-3 block space-y-1">
          <span className="text-xs font-medium text-slate-700">
            Run name (optional override)
          </span>
          <input
            type="text"
            value={runName}
            onChange={(event) => setRunName(event.target.value)}
            placeholder="Q4 Decision Sprint"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>

        <label className="mt-3 block space-y-1">
          <span className="text-xs font-medium text-slate-700">
            Mission (optional override)
          </span>
          <textarea
            value={launchObjective}
            onChange={(event) => setLaunchObjective(event.target.value)}
            placeholder="Debate whether we should launch Feature X in Q2."
            className="h-20 w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>

        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Advanced launch settings
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">
                Max retries (0-5)
              </span>
              <input
                type="number"
                min={0}
                max={5}
                value={maxRetries}
                onChange={(event) => setMaxRetries(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-700">
                Turn timeout (ms)
              </span>
              <input
                type="number"
                min={500}
                max={60000}
                step={100}
                value={turnTimeoutMs}
                onChange={(event) => setTurnTimeoutMs(Number(event.target.value))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
          </div>
        </details>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link
            href={`/studio/${workspaceSlug}/board`}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700"
          >
            Open Board
          </Link>
          <Link
            href={`/studio/${workspaceSlug}/runs`}
            className="rounded-md border border-slate-900 bg-slate-900 px-2.5 py-1.5 font-semibold text-white"
          >
            Open Runs
          </Link>
        </div>

        {error ? (
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </p>
        ) : null}

        {message ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            {message}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {templates.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {loading ? "Loading templates..." : "No templates available."}
          </p>
        ) : (
          templates.map((template) => (
            <article
              key={template.key}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-lg font-semibold text-slate-950">
                  {template.label}
                </h4>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                  {template.runTemplate}
                </span>
              </div>

              <p className="mt-2 text-sm text-slate-600">{template.tagLine}</p>

              <button
                type="button"
                onClick={() => void launchTemplate(template.key)}
                disabled={launchingKey !== null}
                className="mt-3 w-full rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {launchingKey === template.key
                  ? "Launching..."
                  : `Launch ${template.label}`}
              </button>

              <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                  Preset defaults (editable above)
                </summary>
                <div className="mt-2 space-y-2 text-xs text-slate-600">
                  <p>{template.objective}</p>
                  <p>
                    agents: {template.agentCount} | channels: {template.channelCount} |
                    ordered steps: {template.orderedChannelCount}
                  </p>
                  <p>
                    governance policies: {template.policyCount} | initial vote:{" "}
                    {template.hasInitialVote ? "yes" : "no"}
                  </p>
                </div>
              </details>
            </article>
          ))
        )}
      </div>

    </section>
  );
}
