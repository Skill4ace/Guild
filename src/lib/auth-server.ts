import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  AUTH_COOKIE_NAME,
  type SessionUser,
  decodeSessionToken,
} from "@/lib/session";

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return decodeSessionToken(token);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
