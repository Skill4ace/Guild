"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MAX_VAULT_FILE_SIZE_BYTES,
  VAULT_ACCEPTED_FILE_HINT,
  VAULT_TAG_ORDER,
  type VaultTag,
} from "@/lib/vault-shared";

type VaultConsoleProps = {
  workspaceSlug: string;
};

type MountScope = "AGENT" | "CHANNEL" | "RUN";

type VaultItem = {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  tags: VaultTag[];
};

type TargetOption = {
  id: string;
  name: string;
};

type RunOption = {
  id: string;
  name: string | null;
  status: string;
  template: string;
};

type MountRecord = {
  id: string;
  scope: MountScope;
  createdAt: string;
  updatedAt: string;
  vaultItem: VaultItem;
  agent: TargetOption | null;
  channel: TargetOption | null;
  run: { id: string; name: string | null } | null;
};

type MountAuditRecord = {
  id: string;
  mountId: string | null;
  action: "CREATED" | "REMOVED";
  scope: MountScope;
  vaultItemId: string;
  agentId: string | null;
  channelId: string | null;
  runId: string | null;
  actorName: string | null;
  createdAt: string;
};

type MountApiPayload = {
  options?: {
    vaultItems?: VaultItem[];
    agents?: TargetOption[];
    channels?: TargetOption[];
    runs?: RunOption[];
  };
  mounts?: MountRecord[];
  audit?: MountAuditRecord[];
};

const TAG_LABEL: Record<VaultTag, string> = {
  rules: "Rules",
  examples: "Examples",
  assets: "Assets",
  data: "Data",
};

const SCOPE_LABEL: Record<MountScope, string> = {
  AGENT: "Agent",
  CHANNEL: "Channel",
  RUN: "Run",
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  return `${(kb / 1024).toFixed(2)} MB`;
}

async function toResponseError(
  response: Response,
  fallbackMessage: string,
): Promise<Error> {
  let message = fallbackMessage;

  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error.trim();
    }
  } catch {
    // Fall back to default message.
  }

  return new Error(`${message} [${response.status}]`);
}

function readTargetLabel(mount: MountRecord): string {
  if (mount.scope === "AGENT") {
    return mount.agent?.name ?? "Unknown agent";
  }

  if (mount.scope === "CHANNEL") {
    return mount.channel?.name ?? "Unknown channel";
  }

  return mount.run?.name?.trim() || mount.run?.id || "Unknown run";
}

export function VaultConsole({ workspaceSlug }: VaultConsoleProps) {
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [agents, setAgents] = useState<TargetOption[]>([]);
  const [channels, setChannels] = useState<TargetOption[]>([]);
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [mounts, setMounts] = useState<MountRecord[]>([]);
  const [auditEntries, setAuditEntries] = useState<MountAuditRecord[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<VaultTag[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");

  const [mountScope, setMountScope] = useState<MountScope>("AGENT");
  const [selectedMountVaultItemId, setSelectedMountVaultItemId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [mountStatus, setMountStatus] = useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [mountError, setMountError] = useState<string | null>(null);
  const [removingMountId, setRemovingMountId] = useState<string | null>(null);

  const maxFileSizeLabel = useMemo(
    () => `${Math.round(MAX_VAULT_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
    [],
  );

  const loadMountManager = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/mounts`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw await toResponseError(response, "Failed to load mount manager");
      }

      const payload = (await response.json()) as MountApiPayload;

      const nextVaultItems = payload.options?.vaultItems ?? [];
      setVaultItems(nextVaultItems);
      setAgents(payload.options?.agents ?? []);
      setChannels(payload.options?.channels ?? []);
      setRuns(payload.options?.runs ?? []);
      setMounts(payload.mounts ?? []);
      setAuditEntries(payload.audit ?? []);

      setSelectedMountVaultItemId((current) => {
        if (current && nextVaultItems.some((item) => item.id === current)) {
          return current;
        }

        return nextVaultItems[0]?.id ?? "";
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Failed to load mount manager",
      );
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadMountManager();
  }, [loadMountManager]);

  function toggleTag(tag: VaultTag, checked: boolean) {
    setSelectedTags((current) => {
      if (checked) {
        if (current.includes(tag)) {
          return current;
        }

        return [...current, tag];
      }

      return current.filter((entry) => entry !== tag);
    });
  }

  async function uploadItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);

    if (!selectedFile) {
      setUploadStatus("error");
      setUploadError("Choose a file before uploading.");
      return;
    }

    if (selectedFile.size > MAX_VAULT_FILE_SIZE_BYTES) {
      setUploadStatus("error");
      setUploadError(`File exceeds ${maxFileSizeLabel} limit.`);
      return;
    }

    setUploadStatus("uploading");

    const body = new FormData();
    body.append("file", selectedFile);

    if (name.trim()) {
      body.append("name", name.trim());
    }

    selectedTags.forEach((tag) => body.append("tags", tag));

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/vault`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        throw await toResponseError(response, "Upload failed");
      }

      setName("");
      setSelectedTags([]);
      setSelectedFile(null);
      setUploadStatus("done");
      await loadMountManager();
    } catch (error) {
      setUploadStatus("error");
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function createMount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMountError(null);

    if (!selectedMountVaultItemId) {
      setMountStatus("error");
      setMountError("Select a vault item first.");
      return;
    }

    if (mountScope === "AGENT" && !selectedAgentId) {
      setMountStatus("error");
      setMountError("Select an agent target.");
      return;
    }

    if (mountScope === "CHANNEL" && !selectedChannelId) {
      setMountStatus("error");
      setMountError("Select a channel target.");
      return;
    }

    if (mountScope === "RUN" && !selectedRunId) {
      setMountStatus("error");
      setMountError("Select a run target.");
      return;
    }

    setMountStatus("saving");

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/mounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultItemId: selectedMountVaultItemId,
          scope: mountScope,
          agentId: mountScope === "AGENT" ? selectedAgentId : null,
          channelId: mountScope === "CHANNEL" ? selectedChannelId : null,
          runId: mountScope === "RUN" ? selectedRunId : null,
        }),
      });

      if (!response.ok) {
        throw await toResponseError(response, "Failed to create mount");
      }

      setMountStatus("done");
      await loadMountManager();
    } catch (error) {
      setMountStatus("error");
      setMountError(
        error instanceof Error ? error.message : "Failed to create mount",
      );
    }
  }

  async function removeMount(mountId: string) {
    setRemovingMountId(mountId);
    setMountError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/mounts/${mountId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw await toResponseError(response, "Failed to remove mount");
      }

      await loadMountManager();
    } catch (error) {
      setMountError(
        error instanceof Error ? error.message : "Failed to remove mount",
      );
      setMountStatus("error");
    } finally {
      setRemovingMountId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-950">Vault</h2>
        <p className="guild-muted mt-2 text-sm">
          Upload files, then mount them to agents/channels/runs with explicit scope.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_1fr] xl:items-start">
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Upload Item</h3>
            <p className="mt-1 text-xs text-slate-500">
              Accepted: {VAULT_ACCEPTED_FILE_HINT}. Max size: {maxFileSizeLabel}.
            </p>

            <form className="mt-3 space-y-3" onSubmit={uploadItem}>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Display name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="Optional (defaults from filename)"
                />
              </label>

              <fieldset>
                <span className="text-xs font-medium text-slate-600">Tags</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {VAULT_TAG_ORDER.map((tag) => (
                    <label
                      key={tag}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(tag)}
                        onChange={(event) => toggleTag(tag, event.target.checked)}
                        className="h-4 w-4 accent-slate-900"
                      />
                      {TAG_LABEL[tag]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">File</span>
                <input
                  key={selectedFile ? selectedFile.name : "empty"}
                  type="file"
                  accept={VAULT_ACCEPTED_FILE_HINT}
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-white"
                />
              </label>

              {selectedFile ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  {selectedFile.name} ({formatBytes(selectedFile.size)})
                </p>
              ) : null}

              <button
                type="submit"
                disabled={uploadStatus === "uploading"}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadStatus === "uploading" ? "Uploading..." : "Upload to vault"}
              </button>

              {uploadStatus === "done" ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
                  Upload complete.
                </p>
              ) : null}

              {uploadError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  {uploadError}
                </p>
              ) : null}
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Mount Manager</h3>
            <p className="mt-1 text-xs text-slate-500">
              Pick a vault item and scope to control exactly where context is visible.
            </p>

            <form className="mt-3 space-y-3" onSubmit={createMount}>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Vault item</span>
                <select
                  value={selectedMountVaultItemId}
                  onChange={(event) => setSelectedMountVaultItemId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  {vaultItems.length === 0 ? (
                    <option value="">No vault items available</option>
                  ) : null}
                  {vaultItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">Scope</span>
                <select
                  value={mountScope}
                  onChange={(event) => setMountScope(event.target.value as MountScope)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="AGENT">Agent</option>
                  <option value="CHANNEL">Channel</option>
                  <option value="RUN">Run</option>
                </select>
              </label>

              {mountScope === "AGENT" ? (
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Agent target</span>
                  <select
                    value={selectedAgentId}
                    onChange={(event) => setSelectedAgentId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="">Select an agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {mountScope === "CHANNEL" ? (
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Channel target</span>
                  <select
                    value={selectedChannelId}
                    onChange={(event) => setSelectedChannelId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="">Select a channel</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {mountScope === "RUN" ? (
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Run target</span>
                  <select
                    value={selectedRunId}
                    onChange={(event) => setSelectedRunId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="">Select a run</option>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {(run.name?.trim() || run.id) + ` (${run.status})`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <button
                type="submit"
                disabled={mountStatus === "saving"}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mountStatus === "saving" ? "Mounting..." : "Create mount"}
              </button>

              {mountStatus === "done" ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
                  Mount created.
                </p>
              ) : null}

              {mountError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                  {mountError}
                </p>
              ) : null}
            </form>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Vault Library</h3>
              <button
                type="button"
                onClick={() => void loadMountManager()}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>

            {isLoading ? (
              <p className="mt-3 text-sm text-slate-500">Loading vault data...</p>
            ) : null}

            {loadError ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
                {loadError}
              </p>
            ) : null}

            {!isLoading && !loadError && vaultItems.length === 0 ? (
              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No files in this workspace yet. Upload your first rule pack or dataset.
              </p>
            ) : null}

            {vaultItems.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {vaultItems.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.fileName}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedMountVaultItemId(item.id)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Use in mount
                        </button>
                        <a
                          href={`/api/workspaces/${workspaceSlug}/vault/${item.id}/download`}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Download
                        </a>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.length > 0
                        ? item.tags.map((tag) => (
                            <span
                              key={`${item.id}-${tag}`}
                              className="rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700"
                            >
                              {TAG_LABEL[tag]}
                            </span>
                          ))
                        : (
                          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            Untagged
                          </span>
                        )}
                    </div>

                    <p className="mt-2 text-xs text-slate-600">
                      {item.mimeType} • {formatBytes(item.byteSize)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Active Mounts</h3>
            <p className="mt-1 text-xs text-slate-500">
              These are the only files available to selected runtime scopes.
            </p>

            {mounts.length === 0 ? (
              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No mounts yet.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {mounts.map((mount) => (
                  <li
                    key={mount.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {mount.vaultItem.name}
                        </p>
                        <p className="text-xs text-slate-600">
                          {SCOPE_LABEL[mount.scope]}
                          {" to "}
                          {readTargetLabel(mount)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void removeMount(mount.id)}
                        disabled={removingMountId === mount.id}
                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {removingMountId === mount.id ? "Removing..." : "Unmount"}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Last changed {new Date(mount.updatedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Mount Audit Log</h3>
            <p className="mt-1 text-xs text-slate-500">
              Tracks mount create/remove actions over time.
            </p>

            {auditEntries.length === 0 ? (
              <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                No audit events yet.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {auditEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <p className="text-xs font-semibold text-slate-900">
                      {entry.action === "CREATED" ? "Mounted" : "Unmounted"} ({SCOPE_LABEL[entry.scope]})
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Actor: {entry.actorName || "Unknown"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
