import { describe, expect, it } from "vitest";

import {
  MAX_VAULT_FILE_SIZE_BYTES,
  createVaultStorageKey,
  parseVaultTags,
  validateVaultUpload,
} from "./vault";

describe("vault", () => {
  it("parses and deduplicates supported tags", () => {
    expect(parseVaultTags(["rules", "data", "rules", "invalid"])).toEqual([
      "rules",
      "data",
    ]);

    expect(parseVaultTags("examples, assets, unknown")).toEqual([
      "examples",
      "assets",
    ]);
  });

  it("rejects oversized files", () => {
    const result = validateVaultUpload({
      name: "Rules",
      tags: ["rules"],
      fileName: "rules.md",
      mimeType: "text/markdown",
      byteSize: MAX_VAULT_FILE_SIZE_BYTES + 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("limit");
    }
  });

  it("rejects unsupported file types", () => {
    const result = validateVaultUpload({
      name: "Archive",
      tags: ["data"],
      fileName: "archive.zip",
      mimeType: "application/zip",
      byteSize: 512,
    });

    expect(result.ok).toBe(false);
  });

  it("normalizes valid upload payload", () => {
    const result = validateVaultUpload({
      name: "",
      tags: ["rules", "examples", "rules"],
      fileName: "policy_pack.MD",
      mimeType: "",
      byteSize: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("policy pack");
      expect(result.value.mimeType).toBe("text/markdown");
      expect(result.value.tags).toEqual(["rules", "examples"]);
      expect(result.value.fileName).toBe("policy_pack.MD");
    }
  });

  it("creates workspace-scoped storage keys", () => {
    const key = createVaultStorageKey("workspace-1", "rules.md");

    expect(key.startsWith("workspace-1/")).toBe(true);
    expect(key.endsWith(".md")).toBe(true);
    expect(key).toMatch(/workspace-1\/[0-9]{14}-rules-[a-z0-9]{8}\.md/);
  });
});
