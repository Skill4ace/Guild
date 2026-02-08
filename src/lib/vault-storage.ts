import path from "node:path";
import { promises as fs } from "node:fs";

const VAULT_STORAGE_ROOT = path.resolve(
  process.env.VAULT_STORAGE_DIR ?? path.join(process.cwd(), "data", "vault"),
);

function resolveStoragePath(storageKey: string): string {
  const normalizedKey = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalizedKey || normalizedKey.includes("..")) {
    throw new Error("Invalid storage key.");
  }

  const absolutePath = path.resolve(VAULT_STORAGE_ROOT, normalizedKey);
  const isInsideRoot =
    absolutePath === VAULT_STORAGE_ROOT ||
    absolutePath.startsWith(`${VAULT_STORAGE_ROOT}${path.sep}`);

  if (!isInsideRoot) {
    throw new Error("Invalid storage key path.");
  }

  return absolutePath;
}

export async function writeVaultBuffer(storageKey: string, bytes: Uint8Array) {
  const filePath = resolveStoragePath(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

export async function readVaultBuffer(storageKey: string): Promise<Buffer> {
  const filePath = resolveStoragePath(storageKey);
  return fs.readFile(filePath);
}

export async function deleteVaultBuffer(storageKey: string) {
  const filePath = resolveStoragePath(storageKey);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}
