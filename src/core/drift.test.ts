import { describe, expect, it } from "vitest";

import { classifyDrift } from "./drift";
import type { ToolHashes } from "./hash";

const h = (schema: string, semantic: string): ToolHashes => ({
  schemaHash: `sha256:${schema.repeat(64)}`,
  semanticHash: `sha256:${semantic.repeat(64)}`,
});

const BASE = h("a", "b");

function classOf(
  locked: Record<string, ToolHashes>,
  live: Record<string, ToolHashes>,
  tool: string,
): string | undefined {
  return classifyDrift(locked, live).items.find((i) => i.tool === tool)?.class;
}

describe("per-class classification", () => {
  it("clean when both hashes match", () => {
    const report = classifyDrift({ t: BASE }, { t: h("a", "b") });
    expect(report.items[0]?.class).toBe("clean");
    expect(report.summary).toEqual({
      clean: 1,
      structural: 0,
      semantic: 0,
      missing: 0,
      undeclared: 0,
    });
  });

  it("structural when the schema hash differs", () => {
    expect(classOf({ t: BASE }, { t: h("z", "b") }, "t")).toBe("structural");
  });

  it("semantic when only the semantic hash differs", () => {
    expect(classOf({ t: BASE }, { t: h("a", "z") }, "t")).toBe("semantic");
  });

  it("missing when locked but not live", () => {
    expect(classOf({ t: BASE }, {}, "t")).toBe("missing");
  });

  it("undeclared when live but not locked", () => {
    expect(classOf({}, { t: BASE }, "t")).toBe("undeclared");
  });
});

describe("structural precedence", () => {
  it("is structural, not semantic, when both hashes differ", () => {
    expect(classOf({ t: BASE }, { t: h("z", "z") }, "t")).toBe("structural");
  });
});

describe("entry shape", () => {
  it("omits live on a missing entry and locked on an undeclared entry", () => {
    const missing = classifyDrift({ t: BASE }, {}).items[0];
    expect(missing?.locked).toEqual(BASE);
    expect(missing).not.toHaveProperty("live");

    const undeclared = classifyDrift({}, { t: BASE }).items[0];
    expect(undeclared?.live).toEqual(BASE);
    expect(undeclared).not.toHaveProperty("locked");
  });
});

describe("combinations", () => {
  it("classifies a mixed set and counts every class", () => {
    const locked = {
      clean: h("a", "b"),
      struct: h("a", "b"),
      sem: h("a", "b"),
      gone: h("a", "b"),
    };
    const live = {
      clean: h("a", "b"),
      struct: h("z", "b"),
      sem: h("a", "z"),
      extra: h("a", "b"),
    };
    const report = classifyDrift(locked, live);

    expect(report.summary).toEqual({
      clean: 1,
      structural: 1,
      semantic: 1,
      missing: 1,
      undeclared: 1,
    });
    // Sorted by tool name.
    expect(report.items.map((i) => i.tool)).toEqual([
      "clean",
      "extra",
      "gone",
      "sem",
      "struct",
    ]);
    expect(report.items.map((i) => i.class)).toEqual([
      "clean",
      "undeclared",
      "missing",
      "semantic",
      "structural",
    ]);
  });
});

describe("empty inputs", () => {
  it("returns no items and an all-zero summary", () => {
    expect(classifyDrift({}, {})).toEqual({
      items: [],
      summary: {
        clean: 0,
        structural: 0,
        semantic: 0,
        missing: 0,
        undeclared: 0,
      },
    });
  });
});
