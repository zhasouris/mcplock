import { describe, expect, it } from "vitest";

import { fingerprint } from "../core/fingerprint";
import {
  buildDriftReport,
  DriftReportError,
  parseDriftReport,
  renderItemMarkdown,
  renderReportMarkdown,
  type DriftEntry,
} from "./drift-report";

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;
const C = `sha256:${"c".repeat(64)}`;

const ENTRIES: DriftEntry[] = [
  {
    tool: "contracts.list_expiring",
    source: "contracts-api",
    class: "structural",
    locked: { schemaHash: A, semanticHash: B, version: "2.1.0" },
    live: { schemaHash: C, semanticHash: B, version: "2.2.0" },
  },
  {
    tool: "contracts.get_summary",
    source: "contracts-api",
    class: "semantic",
    locked: { schemaHash: A, semanticHash: A },
    live: { schemaHash: A, semanticHash: B },
  },
  {
    tool: "billing.get_invoice",
    source: "billing-api",
    class: "missing",
    locked: { schemaHash: A, semanticHash: B },
  },
  {
    tool: "billing.list_new",
    source: "billing-api",
    class: "undeclared",
    live: { schemaHash: A, semanticHash: B },
  },
];

const GENERATED_AT = "2026-07-28T14:00:00Z";

function build() {
  return buildDriftReport({
    manifest: "mcp-tools.yaml",
    generatedAt: GENERATED_AT,
    entries: ENTRIES,
  });
}

describe("buildDriftReport", () => {
  it("produces a snapshot-stable document", () => {
    expect(build()).toMatchSnapshot();
  });

  it("emits JSON that validates against the schema", () => {
    const json = JSON.stringify(build());
    expect(() => parseDriftReport(JSON.parse(json))).not.toThrow();
  });

  it("counts each class in the summary", () => {
    expect(build().summary).toEqual({
      structural: 1,
      semantic: 1,
      missing: 1,
      undeclared: 1,
      resolutionErrors: 0,
    });
  });

  it("sorts items by tool name", () => {
    expect(build().items.map((i) => i.tool)).toEqual([
      "billing.get_invoice",
      "billing.list_new",
      "contracts.get_summary",
      "contracts.list_expiring",
    ]);
  });

  it("stamps each item with the §7 fingerprint", () => {
    const structural = build().items.find(
      (i) => i.tool === "contracts.list_expiring",
    );
    expect(structural?.fingerprint).toBe(
      fingerprint({
        tool: "contracts.list_expiring",
        class: "structural",
        locked: { schemaHash: A, semanticHash: B },
        live: { schemaHash: C, semanticHash: B },
      }),
    );
  });

  it("omits the live side of a missing item and locked side of an undeclared item", () => {
    const items = build().items;
    const missing = items.find((i) => i.tool === "billing.get_invoice");
    const undeclared = items.find((i) => i.tool === "billing.list_new");
    expect(missing).not.toHaveProperty("live");
    expect(undeclared).not.toHaveProperty("locked");
  });

  it("defaults changes to an empty array", () => {
    expect(build().items.every((i) => Array.isArray(i.changes))).toBe(true);
  });

  it("rejects an invalid generatedAt", () => {
    expect(() =>
      buildDriftReport({
        manifest: "m",
        generatedAt: "not-a-date",
        entries: [],
      }),
    ).toThrow(DriftReportError);
  });
});

describe("renderItemMarkdown", () => {
  it("renders a structural item", () => {
    const [item] = build().items.filter(
      (i) => i.tool === "contracts.list_expiring",
    );
    expect(item?.markdown).toMatchSnapshot();
  });

  it("renders changes when present", () => {
    const md = renderItemMarkdown({
      fingerprint: "0123456789abcdef",
      tool: "t",
      source: "s",
      class: "structural",
      locked: { schemaHash: A, semanticHash: B },
      live: { schemaHash: C, semanticHash: B },
      changes: [
        {
          path: "inputSchema.properties.window",
          kind: "type-changed",
          from: "string",
          to: "integer",
        },
      ],
    });
    expect(md).toMatchSnapshot();
  });

  it("renders a change with no from/to delta", () => {
    const md = renderItemMarkdown({
      fingerprint: "0123456789abcdef",
      tool: "t",
      source: "s",
      class: "structural",
      locked: { schemaHash: A, semanticHash: B },
      live: { schemaHash: C, semanticHash: B },
      changes: [{ path: "annotations.readOnlyHint", kind: "added" }],
    });
    expect(md).toContain("- `annotations.readOnlyHint`: added");
    expect(md).not.toContain("added (");
  });
});

describe("renderReportMarkdown", () => {
  it("renders the full report", () => {
    expect(renderReportMarkdown(build())).toMatchSnapshot();
  });

  it("renders a clean report", () => {
    const clean = buildDriftReport({
      manifest: "mcp-tools.yaml",
      generatedAt: GENERATED_AT,
      entries: [],
    });
    expect(renderReportMarkdown(clean)).toBe(
      "# Drift report\n\n0 structural, 0 semantic, 0 missing, 0 undeclared\n\nNo drift.\n",
    );
  });
});

describe("parseDriftReport", () => {
  it("rejects an unknown schemaVersion", () => {
    const doc = build() as unknown as { schemaVersion: number };
    doc.schemaVersion = 2;
    expect(() => parseDriftReport(doc)).toThrow(DriftReportError);
  });

  it("rejects an unknown key", () => {
    const doc = build() as unknown as Record<string, unknown>;
    doc.extra = true;
    expect(() => parseDriftReport(doc)).toThrow(DriftReportError);
  });
});

describe("resolution-error rendering (engine-injected)", () => {
  it("renders a resolution-error item and its summary line", () => {
    const md = renderItemMarkdown({
      fingerprint: "abcdef0123456789",
      tool: "contracts.list_expiring",
      source: "contracts-api",
      class: "resolution-error",
      changes: [],
    });
    expect(md).toContain("resolution error");
    expect(md).toContain("could not be resolved");

    const base = build();
    const report = {
      ...base,
      summary: { ...base.summary, resolutionErrors: 1 },
    };
    expect(renderReportMarkdown(report)).toContain("1 resolution error");
  });
});

describe("item ordering tie-breaks on class", () => {
  it("orders same-named tools by class and is stable for identical entries", () => {
    const report = buildDriftReport({
      manifest: "mcp-tools.yaml",
      generatedAt: GENERATED_AT,
      entries: [
        {
          tool: "dup",
          source: "s",
          class: "undeclared",
          live: { schemaHash: A, semanticHash: B },
        },
        {
          tool: "dup",
          source: "s",
          class: "missing",
          locked: { schemaHash: A, semanticHash: B },
        },
        {
          tool: "dup",
          source: "s",
          class: "missing",
          locked: { schemaHash: A, semanticHash: B },
        },
      ],
    });
    expect(report.items.map((i) => i.class)).toEqual([
      "missing",
      "missing",
      "undeclared",
    ]);
  });
});
