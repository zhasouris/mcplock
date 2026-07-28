import { describe, expect, it } from "vitest";

import { classifyDrift, type ToolDrift } from "./drift";
import { fingerprint } from "./fingerprint";

const FP = /^[0-9a-f]{16}$/;

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;
const C = `sha256:${"c".repeat(64)}`;
const D = `sha256:${"d".repeat(64)}`;

const ITEM: ToolDrift = {
  tool: "contracts.list_expiring",
  class: "structural",
  locked: { schemaHash: A, semanticHash: B },
  live: { schemaHash: C, semanticHash: B },
};

describe("known vector", () => {
  it("is a stable 16-hex fingerprint", () => {
    expect(fingerprint(ITEM)).toBe("120a0153721f5797");
  });

  it("emits 16 lowercase hex chars", () => {
    expect(fingerprint(ITEM)).toMatch(FP);
  });
});

describe("determinism", () => {
  it("is identical across repeated runs", () => {
    expect(fingerprint(ITEM)).toBe(fingerprint(ITEM));
  });

  it("is independent of object key order (via canonicalization)", () => {
    const rebuilt: ToolDrift = {
      class: "structural",
      tool: "contracts.list_expiring",
      live: { semanticHash: B, schemaHash: C },
      locked: { semanticHash: B, schemaHash: A },
    };
    expect(fingerprint(rebuilt)).toBe(fingerprint(ITEM));
  });
});

describe("any change yields a new fingerprint", () => {
  it("a different class", () => {
    expect(fingerprint({ ...ITEM, class: "semantic" })).not.toBe(
      fingerprint(ITEM),
    );
  });

  it("a change on the live side", () => {
    expect(
      fingerprint({ ...ITEM, live: { schemaHash: D, semanticHash: B } }),
    ).not.toBe(fingerprint(ITEM));
  });

  it("a change on the locked side", () => {
    expect(
      fingerprint({ ...ITEM, locked: { schemaHash: D, semanticHash: B } }),
    ).not.toBe(fingerprint(ITEM));
  });

  it("a different tool name", () => {
    expect(fingerprint({ ...ITEM, tool: "billing.get_invoice" })).not.toBe(
      fingerprint(ITEM),
    );
  });
});

describe("one-sided items", () => {
  it("fingerprints missing and undeclared, and they differ", () => {
    const missing: ToolDrift = {
      tool: "t",
      class: "missing",
      locked: { schemaHash: A, semanticHash: B },
    };
    const undeclared: ToolDrift = {
      tool: "t",
      class: "undeclared",
      live: { schemaHash: A, semanticHash: B },
    };
    expect(fingerprint(missing)).toMatch(FP);
    expect(fingerprint(undeclared)).toMatch(FP);
    expect(fingerprint(missing)).not.toBe(fingerprint(undeclared));
  });
});

describe("dedup contract (end to end with classifyDrift)", () => {
  it("a resolved drift's fingerprint disappears", () => {
    const locked = { t: { schemaHash: A, semanticHash: B } };

    const drifting = classifyDrift(locked, {
      t: { schemaHash: C, semanticHash: B },
    })
      .items.filter((i) => i.class !== "clean")
      .map(fingerprint);
    expect(drifting).toHaveLength(1);

    // Resolve: the live surface now matches the lockfile again.
    const afterResolve = classifyDrift(locked, {
      t: { schemaHash: A, semanticHash: B },
    })
      .items.filter((i) => i.class !== "clean")
      .map(fingerprint);

    expect(afterResolve).toHaveLength(0);
    expect(afterResolve).not.toContain(drifting[0]);
  });
});
