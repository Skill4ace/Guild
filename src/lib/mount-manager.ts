import { MountAuditAction, MountScope } from "@prisma/client";

import { parseVaultTags, type VaultTag } from "./vault-shared";

export const MOUNT_SCOPE_ORDER = [
  MountScope.AGENT,
  MountScope.CHANNEL,
  MountScope.RUN,
] as const;

export type MountScopeValue = (typeof MOUNT_SCOPE_ORDER)[number];

export type MountTargetRef = {
  scope: MountScopeValue;
  agentId: string | null;
  channelId: string | null;
  runId: string | null;
};

export type MountCreateInput = {
  vaultItemId?: unknown;
  scope?: unknown;
  agentId?: unknown;
  channelId?: unknown;
  runId?: unknown;
};

export type MountCreatePayload = {
  vaultItemId: string;
  target: MountTargetRef;
};

export type MountAuditActionValue = "CREATED" | "REMOVED";

export type SerializedMount = {
  id: string;
  scope: MountScopeValue;
  createdAt: string;
  updatedAt: string;
  vaultItem: {
    id: string;
    name: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    tags: VaultTag[];
  };
  agent: { id: string; name: string } | null;
  channel: { id: string; name: string } | null;
  run: { id: string; name: string | null } | null;
};

export type SerializedMountAudit = {
  id: string;
  mountId: string | null;
  action: MountAuditActionValue;
  scope: MountScopeValue;
  vaultItemId: string;
  agentId: string | null;
  channelId: string | null;
  runId: string | null;
  actorName: string | null;
  createdAt: string;
};

export type MountResolverInput = {
  runId: string | null;
  agentId: string | null;
  channelId: string | null;
};

export type ResolvedMountContextItem = {
  vaultItemId: string;
  name: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  tags: VaultTag[];
  storageKey: string;
  mountedByScopes: MountScopeValue[];
  mountedByIds: string[];
};

export type ResolvedMountContext = {
  runId: string | null;
  agentId: string | null;
  channelId: string | null;
  items: ResolvedMountContextItem[];
};

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMountScope(value: unknown): value is MountScopeValue {
  return (
    value === MountScope.AGENT ||
    value === MountScope.CHANNEL ||
    value === MountScope.RUN
  );
}

function toTargetRef(scope: MountScopeValue, input: MountCreateInput): MountTargetRef {
  if (scope === MountScope.AGENT) {
    return {
      scope,
      agentId: normalizeId(input.agentId),
      channelId: null,
      runId: null,
    };
  }

  if (scope === MountScope.CHANNEL) {
    return {
      scope,
      agentId: null,
      channelId: normalizeId(input.channelId),
      runId: null,
    };
  }

  return {
    scope,
    agentId: null,
    channelId: null,
    runId: normalizeId(input.runId),
  };
}

export function validateMountCreateInput(
  input: MountCreateInput,
):
  | { ok: true; value: MountCreatePayload }
  | { ok: false; error: string } {
  const vaultItemId = normalizeId(input.vaultItemId);

  if (!vaultItemId) {
    return { ok: false, error: "Select a vault item to mount." };
  }

  if (!isMountScope(input.scope)) {
    return { ok: false, error: "Select a valid mount scope." };
  }

  const target = toTargetRef(input.scope, input);

  if (target.scope === MountScope.AGENT && !target.agentId) {
    return { ok: false, error: "Choose an agent target for AGENT scope." };
  }

  if (target.scope === MountScope.CHANNEL && !target.channelId) {
    return { ok: false, error: "Choose a channel target for CHANNEL scope." };
  }

  if (target.scope === MountScope.RUN && !target.runId) {
    return { ok: false, error: "Choose a run target for RUN scope." };
  }

  return {
    ok: true,
    value: {
      vaultItemId,
      target,
    },
  };
}

export function serializeMount(mount: {
  id: string;
  scope: MountScopeValue;
  createdAt: Date;
  updatedAt: Date;
  vaultItem: {
    id: string;
    name: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    tags: unknown;
  };
  agent: { id: string; name: string } | null;
  channel: { id: string; name: string } | null;
  run: { id: string; name: string | null } | null;
}): SerializedMount {
  return {
    id: mount.id,
    scope: mount.scope,
    createdAt: mount.createdAt.toISOString(),
    updatedAt: mount.updatedAt.toISOString(),
    vaultItem: {
      id: mount.vaultItem.id,
      name: mount.vaultItem.name,
      fileName: mount.vaultItem.fileName,
      mimeType: mount.vaultItem.mimeType,
      byteSize: mount.vaultItem.byteSize,
      tags: parseVaultTags(mount.vaultItem.tags),
    },
    agent: mount.agent,
    channel: mount.channel,
    run: mount.run,
  };
}

export function serializeMountAuditEntry(entry: {
  id: string;
  mountId: string | null;
  action: MountAuditAction;
  scope: MountScopeValue;
  vaultItemId: string;
  agentId: string | null;
  channelId: string | null;
  runId: string | null;
  actorName: string | null;
  createdAt: Date;
}): SerializedMountAudit {
  return {
    id: entry.id,
    mountId: entry.mountId,
    action: entry.action,
    scope: entry.scope,
    vaultItemId: entry.vaultItemId,
    agentId: entry.agentId,
    channelId: entry.channelId,
    runId: entry.runId,
    actorName: entry.actorName,
    createdAt: entry.createdAt.toISOString(),
  };
}

function shouldIncludeMount(
  mount: {
    scope: MountScopeValue;
    runId: string | null;
    agentId: string | null;
    channelId: string | null;
  },
  input: MountResolverInput,
): boolean {
  if (mount.scope === MountScope.RUN) {
    return Boolean(input.runId && mount.runId === input.runId);
  }

  if (mount.scope === MountScope.AGENT) {
    return Boolean(input.agentId && mount.agentId === input.agentId);
  }

  if (mount.scope === MountScope.CHANNEL) {
    return Boolean(input.channelId && mount.channelId === input.channelId);
  }

  return false;
}

export function resolveMountContextFromMounts(
  mounts: Array<{
    id: string;
    scope: MountScopeValue;
    runId: string | null;
    agentId: string | null;
    channelId: string | null;
    vaultItem: {
      id: string;
      name: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      storageKey: string;
      tags: unknown;
    };
  }>,
  input: MountResolverInput,
): ResolvedMountContext {
  const contextByVaultId = new Map<string, ResolvedMountContextItem>();

  for (const mount of mounts) {
    if (!shouldIncludeMount(mount, input)) {
      continue;
    }

    const existing = contextByVaultId.get(mount.vaultItem.id);
    if (!existing) {
      contextByVaultId.set(mount.vaultItem.id, {
        vaultItemId: mount.vaultItem.id,
        name: mount.vaultItem.name,
        fileName: mount.vaultItem.fileName,
        mimeType: mount.vaultItem.mimeType,
        byteSize: mount.vaultItem.byteSize,
        storageKey: mount.vaultItem.storageKey,
        tags: parseVaultTags(mount.vaultItem.tags),
        mountedByScopes: [mount.scope],
        mountedByIds: [mount.id],
      });
      continue;
    }

    if (!existing.mountedByScopes.includes(mount.scope)) {
      existing.mountedByScopes.push(mount.scope);
    }

    if (!existing.mountedByIds.includes(mount.id)) {
      existing.mountedByIds.push(mount.id);
    }
  }

  const items = Array.from(contextByVaultId.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return {
    runId: input.runId,
    agentId: input.agentId,
    channelId: input.channelId,
    items,
  };
}
