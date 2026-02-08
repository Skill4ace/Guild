import { describe, expect, it } from "vitest";

import { slugifyWorkspaceName } from "./slug";

describe("slugifyWorkspaceName", () => {
  it("builds lower-case URL-safe workspace slugs", () => {
    expect(slugifyWorkspaceName("Product Council 2026")).toBe(
      "product-council-2026",
    );
  });

  it("falls back when input has no usable characters", () => {
    expect(slugifyWorkspaceName("___")).toBe("workspace");
  });
});
