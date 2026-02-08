export const VAULT_TAG_ORDER = ["rules", "examples", "assets", "data"] as const;
export type VaultTag = (typeof VAULT_TAG_ORDER)[number];

export const MAX_VAULT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_VAULT_NAME_LENGTH = 80;

export const VAULT_ACCEPTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
] as const;

export const VAULT_ACCEPTED_FILE_HINT = VAULT_ACCEPTED_EXTENSIONS.join(", ");

export function parseVaultTags(input: unknown): VaultTag[] {
  const values: string[] = [];

  if (typeof input === "string") {
    values.push(...input.split(","));
  } else if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === "string") {
        values.push(...entry.split(","));
      }
    }
  }

  const allowed = new Set(VAULT_TAG_ORDER);

  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is VaultTag => allowed.has(value as VaultTag))
    .filter((value, index, collection) => collection.indexOf(value) === index);
}
