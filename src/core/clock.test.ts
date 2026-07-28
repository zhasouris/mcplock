import { describe, expect, it } from "vitest";

import { systemClock } from "./clock";

describe("systemClock", () => {
  it("returns a positive epoch-millisecond number", () => {
    const now = systemClock();
    expect(typeof now).toBe("number");
    expect(now).toBeGreaterThan(0);
  });
});
