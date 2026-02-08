import { describe, expect, it } from "vitest";

import { decodeSessionToken, encodeSessionToken } from "./session";

describe("session token helpers", () => {
  it("encodes and decodes a valid session token", () => {
    const session = {
      id: "user-1",
      name: "Rehan",
      issuedAt: Date.now(),
    };

    const token = encodeSessionToken(session);
    const decoded = decodeSessionToken(token);

    expect(decoded).toEqual(session);
  });

  it("returns null for malformed token values", () => {
    expect(decodeSessionToken("not-a-real-token")).toBeNull();
  });

  it("returns null when token is expired", () => {
    const now = Date.now();
    const oldSession = {
      id: "user-2",
      name: "Old User",
      issuedAt: now - 8 * 24 * 60 * 60 * 1000,
    };

    const token = encodeSessionToken(oldSession);

    expect(decodeSessionToken(token, now)).toBeNull();
  });
});
