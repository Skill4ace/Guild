import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  MAX_VAULT_FILE_SIZE_BYTES,
  MAX_VAULT_NAME_LENGTH,
  VAULT_ACCEPTED_EXTENSIONS,
  VAULT_ACCEPTED_FILE_HINT,
  parseVaultTags,
  type VaultTag,
} from "./vault-shared";
export {
  MAX_VAULT_FILE_SIZE_BYTES,
  MAX_VAULT_NAME_LENGTH,
  VAULT_ACCEPTED_EXTENSIONS,
  VAULT_ACCEPTED_FILE_HINT,
  parseVaultTags,
  type VaultTag,
} from "./vault-shared";

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const ALLOWED_EXTENSIONS = new Set<string>(VAULT_ACCEPTED_EXTENSIONS);

type VaultUploadCandidate = {
  name: unknown;
  tags: unknown;
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type VaultUploadPayload = {
  name: string;
  tags: VaultTag[];
  fileName: string;
  mimeType: string;
  byteSize: number;
};

export type VaultUploadValidation =
  | { ok: true; value: VaultUploadPayload }
  | { ok: false; error: string };

function inferMimeType(fileName: string, mimeType: string): string {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return normalizedMime;
  }

  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? normalizedMime;
}

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/\s+/g, " ").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, "-");

  if (cleaned.length === 0) {
    return "file.txt";
  }

  return cleaned.slice(0, 140);
}

function defaultNameFromFileName(fileName: string): string {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  const cleaned = stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) {
    return "Untitled file";
  }

  return cleaned.slice(0, MAX_VAULT_NAME_LENGTH);
}

function sanitizeName(input: unknown, fileName: string): { ok: true; value: string } | { ok: false; error: string } {
  const provided = typeof input === "string" ? input.trim() : "";

  if (provided.length === 0) {
    return { ok: true, value: defaultNameFromFileName(fileName) };
  }

  if (provided.length < 2 || provided.length > MAX_VAULT_NAME_LENGTH) {
    return {
      ok: false,
      error: `Name must be between 2 and ${MAX_VAULT_NAME_LENGTH} characters.`,
    };
  }

  return { ok: true, value: provided };
}

export function validateVaultUpload(candidate: VaultUploadCandidate): VaultUploadValidation {
  if (!candidate.fileName || candidate.fileName.trim().length === 0) {
    return { ok: false, error: "Please choose a file to upload." };
  }

  const byteSize = Number.isFinite(candidate.byteSize)
    ? Math.max(0, Math.floor(candidate.byteSize))
    : 0;

  if (byteSize <= 0) {
    return { ok: false, error: "File is empty." };
  }

  if (byteSize > MAX_VAULT_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File exceeds ${Math.round(MAX_VAULT_FILE_SIZE_BYTES / (1024 * 1024))}MB limit.`,
    };
  }

  const fileName = sanitizeFileName(candidate.fileName);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = inferMimeType(fileName, candidate.mimeType);

  if (!ALLOWED_MIME_TYPES.has(mimeType) && !ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `Unsupported file type. Allowed: ${VAULT_ACCEPTED_FILE_HINT}.`,
    };
  }

  const name = sanitizeName(candidate.name, fileName);
  if (!name.ok) {
    return name;
  }

  return {
    ok: true,
    value: {
      name: name.value,
      tags: parseVaultTags(candidate.tags),
      fileName,
      mimeType,
      byteSize,
    },
  };
}

export function createVaultStorageKey(workspaceId: string, fileName: string): string {
  const safeWorkspace = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "workspace";
  const ext = path.extname(fileName).toLowerCase().slice(0, 10);
  const stem = path
    .basename(fileName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "file";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = randomUUID().slice(0, 8);

  return `${safeWorkspace}/${stamp}-${stem}-${suffix}${ext}`;
}
