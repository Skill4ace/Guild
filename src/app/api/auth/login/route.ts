import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  encodeSessionToken,
} from "@/lib/session";

type LoginBody = {
  name?: unknown;
};

export async function POST(request: Request) {
  let body: LoginBody;

  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body. Expected JSON." },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (name.length < 2 || name.length > 60) {
    return NextResponse.json(
      { error: "Name must be between 2 and 60 characters." },
      { status: 400 },
    );
  }

  const sessionToken = encodeSessionToken({
    id: randomUUID(),
    name,
    issuedAt: Date.now(),
  });

  const response = NextResponse.json({
    ok: true,
    user: { name },
  });

  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return response;
}
