import { describe, expect, it } from "vitest";

import { harnessReady } from "./index";

describe("harness", () => {
  it("wires up the build/test/coverage toolchain", () => {
    expect(harnessReady()).toBe("mcplock harness ready");
  });
});
