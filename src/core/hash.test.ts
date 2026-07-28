import { describe, expect, it } from "vitest";

import {
  hashTool,
  semanticHash,
  structuralHash,
  type ToolDefinition,
} from "./hash";

const HASH = /^sha256:[0-9a-f]{64}$/;

const TOOL: ToolDefinition = {
  name: "contracts.list_expiring",
  title: "List Expiring Contracts",
  description: "Return contracts expiring within a window.",
  inputSchema: {
    type: "object",
    properties: { window: { type: "string" } },
    required: ["window"],
  },
  outputSchema: { type: "array" },
  annotations: { readOnlyHint: true, destructiveHint: false },
};

function mutate(overrides: Partial<ToolDefinition>): ToolDefinition {
  return { ...structuredClone(TOOL), ...overrides };
}

describe("known vectors", () => {
  // Digests computed independently from the RFC 8785 canonical strings.
  it("structural hash is stable", () => {
    expect(structuralHash(TOOL)).toBe(
      "sha256:ad750d82f02a8ecfad65178da70496b2db834777c96def65a287dae194680bf8",
    );
  });

  it("semantic hash is stable", () => {
    expect(semanticHash(TOOL)).toBe(
      "sha256:9cd4c5494e4e105ebbc413c118263e7cd44bf402d9c21ac8775007d8332d2047",
    );
  });

  it("hashTool maps to the lockfile field names", () => {
    expect(hashTool(TOOL)).toEqual({
      schemaHash: structuralHash(TOOL),
      semanticHash: semanticHash(TOOL),
    });
  });

  it("emits sha256:<64 hex>", () => {
    expect(structuralHash(TOOL)).toMatch(HASH);
    expect(semanticHash(TOOL)).toMatch(HASH);
  });
});

describe("semantic-only edits move only the semantic hash", () => {
  it("a reworded description", () => {
    const edited = mutate({ description: "Reworded, same schema." });
    expect(semanticHash(edited)).not.toBe(semanticHash(TOOL));
    expect(structuralHash(edited)).toBe(structuralHash(TOOL));
  });

  it("a changed title", () => {
    const edited = mutate({ title: "Expiring Contracts" });
    expect(semanticHash(edited)).not.toBe(semanticHash(TOOL));
    expect(structuralHash(edited)).toBe(structuralHash(TOOL));
  });
});

describe("structural edits move only the structural hash", () => {
  it("a changed inputSchema (type change)", () => {
    const edited = mutate({
      inputSchema: {
        type: "object",
        properties: { window: { type: "integer" } },
        required: ["window"],
      },
    });
    expect(structuralHash(edited)).not.toBe(structuralHash(TOOL));
    expect(semanticHash(edited)).toBe(semanticHash(TOOL));
  });

  it("a changed outputSchema", () => {
    const edited = mutate({ outputSchema: { type: "object" } });
    expect(structuralHash(edited)).not.toBe(structuralHash(TOOL));
    expect(semanticHash(edited)).toBe(semanticHash(TOOL));
  });

  it("a flipped annotation", () => {
    const edited = mutate({
      annotations: { readOnlyHint: false, destructiveHint: false },
    });
    expect(structuralHash(edited)).not.toBe(structuralHash(TOOL));
    expect(semanticHash(edited)).toBe(semanticHash(TOOL));
  });
});

describe("determinism", () => {
  it("is stable under inputSchema key reordering", () => {
    const reordered = mutate({
      inputSchema: {
        required: ["window"],
        type: "object",
        properties: { window: { type: "string" } },
      },
    });
    expect(structuralHash(reordered)).toBe(structuralHash(TOOL));
  });

  it("treats an absent field and an explicit undefined identically", () => {
    const absent: ToolDefinition = {
      name: "x",
      inputSchema: { type: "object" },
    };
    const explicitUndefined: ToolDefinition = {
      name: "x",
      inputSchema: { type: "object" },
      outputSchema: undefined,
      annotations: undefined,
    };
    expect(structuralHash(absent)).toBe(structuralHash(explicitUndefined));
  });
});
