import { describe, expect, it } from "vitest";

import { getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("returns a healthy payload", () => {
    const health = getHealthStatus();

    expect(health.status).toBe("ok");
    expect(health.service).toBe("guild-web");
    expect(typeof health.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
