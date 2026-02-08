import { MountScope } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  resolveMountContextFromMounts,
  serializeMount,
  validateMountCreateInput,
} from "./mount-manager";

describe("mount-manager", () => {
  it("validates mount payload by scope", () => {
    const invalid = validateMountCreateInput({
      vaultItemId: "vault-1",
      scope: MountScope.AGENT,
      agentId: "",
    });

    expect(invalid.ok).toBe(false);

    const valid = validateMountCreateInput({
      vaultItemId: "vault-1",
      scope: MountScope.RUN,
      runId: "run-1",
    });

    expect(valid.ok).toBe(true);
  });

  it("serializes mount payload with parsed tags", () => {
    const serialized = serializeMount({
      id: "mount-1",
      scope: MountScope.CHANNEL,
      createdAt: new Date("2026-02-07T12:00:00.000Z"),
      updatedAt: new Date("2026-02-07T12:01:00.000Z"),
      vaultItem: {
        id: "vault-1",
        name: "Rules",
        fileName: "rules.md",
        mimeType: "text/markdown",
        byteSize: 100,
        tags: ["rules", "unknown", "rules"],
      },
      agent: null,
      channel: { id: "channel-1", name: "QA Channel" },
      run: null,
    });

    expect(serialized.vaultItem.tags).toEqual(["rules"]);
    expect(serialized.scope).toBe(MountScope.CHANNEL);
  });

  it("resolves run context with only selected mounts", () => {
    const resolved = resolveMountContextFromMounts(
      [
        {
          id: "mount-run",
          scope: MountScope.RUN,
          runId: "run-1",
          agentId: null,
          channelId: null,
          vaultItem: {
            id: "vault-a",
            name: "Run Rules",
            fileName: "run-rules.md",
            mimeType: "text/markdown",
            byteSize: 120,
            storageKey: "workspace/run-rules.md",
            tags: ["rules"],
          },
        },
        {
          id: "mount-agent",
          scope: MountScope.AGENT,
          runId: null,
          agentId: "agent-1",
          channelId: null,
          vaultItem: {
            id: "vault-b",
            name: "Agent Notes",
            fileName: "agent-notes.md",
            mimeType: "text/markdown",
            byteSize: 140,
            storageKey: "workspace/agent-notes.md",
            tags: ["examples"],
          },
        },
        {
          id: "mount-channel",
          scope: MountScope.CHANNEL,
          runId: null,
          agentId: null,
          channelId: "channel-1",
          vaultItem: {
            id: "vault-c",
            name: "Channel Data",
            fileName: "channel-data.csv",
            mimeType: "text/csv",
            byteSize: 200,
            storageKey: "workspace/channel-data.csv",
            tags: ["data"],
          },
        },
        {
          id: "mount-other-run",
          scope: MountScope.RUN,
          runId: "run-2",
          agentId: null,
          channelId: null,
          vaultItem: {
            id: "vault-x",
            name: "Other Run",
            fileName: "other.md",
            mimeType: "text/markdown",
            byteSize: 80,
            storageKey: "workspace/other.md",
            tags: ["rules"],
          },
        },
      ],
      {
        runId: "run-1",
        agentId: "agent-1",
        channelId: "channel-1",
      },
    );

    expect(resolved.items).toHaveLength(3);
    expect(resolved.items.map((item) => item.vaultItemId).sort()).toEqual([
      "vault-a",
      "vault-b",
      "vault-c",
    ]);
  });
});
