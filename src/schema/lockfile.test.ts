import { describe, expect, it } from "vitest";

import {
  LockfileError,
  parseLockfile,
  parseLockfileText,
  serializeLockfile,
  type Lockfile,
} from "./lockfile";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function lockedTool(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: "contracts-api",
    resolvedServer: "https://mcp.internal.example/contracts",
    serverVersion: "2.1.0",
    schemaHash: HASH_A,
    semanticHash: HASH_B,
    scopes: ["Contracts.Read"],
    forwardChain: [],
    resolvedAt: "2026-07-28T14:00:00Z",
    ...overrides,
  };
}

function sampleLockfile(tools: Record<string, unknown>): unknown {
  return {
    schemaVersion: 1,
    generatedBy: "mcplock@0.1.0",
    tools,
  };
}

describe("serializeLockfile", () => {
  it("pretty-prints with a trailing newline", () => {
    const text = serializeLockfile(
      parseLockfile(sampleLockfile({ "a.tool": lockedTool() })),
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 1,');
  });

  it("orders tool names lexicographically regardless of input order", () => {
    const text = serializeLockfile(
      parseLockfile(
        sampleLockfile({
          "z.tool": lockedTool(),
          "a.tool": lockedTool(),
          "m.tool": lockedTool(),
        }),
      ),
    );
    const order = [...text.matchAll(/"([az].tool|m\.tool)":/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["a.tool", "m.tool", "z.tool"]);
  });

  it("emits fields in the fixed canonical order", () => {
    const text = serializeLockfile(
      parseLockfile(sampleLockfile({ "a.tool": lockedTool() })),
    );
    const fields = [
      "source",
      "resolvedServer",
      "serverVersion",
      "schemaHash",
      "semanticHash",
      "scopes",
      "forwardChain",
      "resolvedAt",
    ];
    const positions = fields.map((f) => text.indexOf(`"${f}"`));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("drops an absent serverVersion", () => {
    const text = serializeLockfile(
      parseLockfile(
        sampleLockfile({ "a.tool": lockedTool({ serverVersion: undefined }) }),
      ),
    );
    expect(text).not.toContain("serverVersion");
  });

  it("produces byte-identical output for identical input in different key order", () => {
    // Different tool-name insertion order AND different field insertion order.
    const first = serializeLockfile(
      parseLockfile(
        sampleLockfile({
          "b.tool": lockedTool(),
          "a.tool": lockedTool(),
        }),
      ),
    );
    const second = serializeLockfile(
      parseLockfile(
        sampleLockfile({
          "a.tool": {
            resolvedAt: "2026-07-28T14:00:00Z",
            forwardChain: [],
            scopes: ["Contracts.Read"],
            semanticHash: HASH_B,
            schemaHash: HASH_A,
            serverVersion: "2.1.0",
            resolvedServer: "https://mcp.internal.example/contracts",
            source: "contracts-api",
          },
          "b.tool": lockedTool(),
        }),
      ),
    );
    expect(first).toBe(second);
  });
});

describe("round trip", () => {
  it("serialize -> parse -> serialize is byte-identical", () => {
    const lockfile: Lockfile = parseLockfile(
      sampleLockfile({ "a.tool": lockedTool(), "b.tool": lockedTool() }),
    );
    const once = serializeLockfile(lockfile);
    const twice = serializeLockfile(parseLockfileText(once));
    expect(twice).toBe(once);
  });

  it("parseLockfileText(serialize(x)) preserves the data", () => {
    const lockfile = parseLockfile(sampleLockfile({ "a.tool": lockedTool() }));
    expect(parseLockfileText(serializeLockfile(lockfile))).toEqual(lockfile);
  });
});

describe("parseLockfile", () => {
  it("defaults scopes and forwardChain to []", () => {
    const parsed = parseLockfile(
      sampleLockfile({
        "a.tool": lockedTool({ scopes: undefined, forwardChain: undefined }),
      }),
    );
    expect(parsed.tools["a.tool"]?.scopes).toEqual([]);
    expect(parsed.tools["a.tool"]?.forwardChain).toEqual([]);
  });

  describe("rejects", () => {
    it("an unknown schemaVersion", () => {
      const raw = sampleLockfile({ "a.tool": lockedTool() }) as Record<
        string,
        unknown
      >;
      raw.schemaVersion = 2;
      expect(() => parseLockfile(raw)).toThrow(LockfileError);
    });

    it("a malformed hash", () => {
      expect(() =>
        parseLockfile(
          sampleLockfile({ "a.tool": lockedTool({ schemaHash: "deadbeef" }) }),
        ),
      ).toThrow(/sha256/);
    });

    it("a non-URL resolvedServer", () => {
      expect(() =>
        parseLockfile(
          sampleLockfile({ "a.tool": lockedTool({ resolvedServer: "nope" }) }),
        ),
      ).toThrow(LockfileError);
    });

    it("a non-ISO resolvedAt", () => {
      expect(() =>
        parseLockfile(
          sampleLockfile({ "a.tool": lockedTool({ resolvedAt: "yesterday" }) }),
        ),
      ).toThrow(LockfileError);
    });

    it("an unknown tool key", () => {
      expect(() =>
        parseLockfile(
          sampleLockfile({ "a.tool": lockedTool({ extra: true }) }),
        ),
      ).toThrow(LockfileError);
    });

    it("a non-object root (issue reported at (root))", () => {
      expect(() => parseLockfile(42)).toThrow(LockfileError);
    });
  });

  it("parseLockfileText rejects malformed JSON", () => {
    expect(() => parseLockfileText("{ not json")).toThrow(/not valid JSON/);
  });
});
