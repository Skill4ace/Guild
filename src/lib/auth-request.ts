import { AUTH_COOKIE_NAME, decodeSessionToken, type SessionUser } from "./session";

export function getSessionUserFromRequest(request: Request): SessionUser | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const tokenPair = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${AUTH_COOKIE_NAME}=`));

  if (!tokenPair) {
    return null;
  }

  const encodedToken = tokenPair.slice(AUTH_COOKIE_NAME.length + 1);
  const token = decodeURIComponent(encodedToken);

  return decodeSessionToken(token);
}
