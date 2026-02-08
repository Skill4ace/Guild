export const AUTH_COOKIE_NAME = "guild_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

export type SessionUser = {
  id: string;
  name: string;
  issuedAt: number;
};

function isValidSessionPayload(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.id === "string" &&
    payload.id.length > 0 &&
    typeof payload.name === "string" &&
    payload.name.length > 0 &&
    typeof payload.issuedAt === "number"
  );
}

export function encodeSessionToken(user: SessionUser): string {
  return Buffer.from(JSON.stringify(user)).toString("base64url");
}

export function decodeSessionToken(
  token: string,
  nowMs: number = Date.now(),
): SessionUser | null {
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(json);

    if (!isValidSessionPayload(parsed)) {
      return null;
    }

    if (nowMs - parsed.issuedAt > SESSION_MAX_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
