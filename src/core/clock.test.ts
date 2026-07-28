import { describe, expect, it } from "vitest";

import { parseIsoToMs, systemClock } from "./clock";

describe("systemClock", () => {
  it("returns a positive epoch-millisecond number", () => {
    const now = systemClock();
    expect(typeof now).toBe("number");
    expect(now).toBeGreaterThan(0);
  });
});

describe("parseIsoToMs", () => {
  it("parses a valid ISO-8601 string to epoch ms", () => {
    expect(parseIsoToMs("1970-01-01T00:01:00Z")).toBe(60_000);
  });

  it("returns undefined for an unparseable string", () => {
    expect(parseIsoToMs("not-a-date")).toBeUndefined();
  });
});
