/**
 * Drift report document (COMMAND_SPEC §6) — the `--report-json` contract
 * consumed by mcplock-action, plus a per-item markdown renderer.
 *
 * Zod is the single source of truth: {@link buildDriftReport} re-validates its
 * own output through {@link parseDriftReport} before returning, so an emitted
 * report always conforms. Consumers reject unknown `schemaVersion` (§6) — the
 * `literal(1)` enforces that.
 *
 * `changes[]` (structural diff paths) is first-class in the schema and markdown
 * but populated by the diff engine (Phase 3); entries may already carry it, and
 * because the field exists, populating it later is non-breaking.
 */
import { z } from "zod";

import { fingerprint } from "../core/fingerprint";

const HASH = /^sha256:[0-9a-f]{64}$/;
const FINGERPRINT = /^[0-9a-f]{16}$/;

/** Kinds of structural change recorded in `changes[]`. */
export const CHANGE_KINDS = [
  "added",
  "removed",
  "type-changed",
  "value-changed",
] as const;

const ChangeSchema = z
  .object({
    path: z.string(),
    kind: z.enum(CHANGE_KINDS),
    from: z.unknown().optional(),
    to: z.unknown().optional(),
  })
  .strict();

const SideSchema = z
  .object({
    schemaHash: z.string().regex(HASH),
    semanticHash: z.string().regex(HASH),
    version: z.string().optional(),
  })
  .strict();

/** Drift classes in a report (COMMAND_SPEC §6). */
export const DRIFT_CLASSES = [
  "structural",
  "semantic",
  "missing",
  "undeclared",
  "resolution-error",
] as const;

const ItemSchema = z
  .object({
    fingerprint: z.string().regex(FINGERPRINT),
    tool: z.string(),
    source: z.string(),
    class: z.enum(DRIFT_CLASSES),
    locked: SideSchema.optional(),
    live: SideSchema.optional(),
    changes: z.array(ChangeSchema),
    markdown: z.string(),
  })
  .strict();

const SummarySchema = z
  .object({
    structural: z.number().int().nonnegative(),
    semantic: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    undeclared: z.number().int().nonnegative(),
    resolutionErrors: z.number().int().nonnegative(),
  })
  .strict();

export const DriftReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    manifest: z.string(),
    summary: SummarySchema,
    items: z.array(ItemSchema),
  })
  .strict();

export type DriftReportDocument = z.infer<typeof DriftReportSchema>;
export type DriftReportItem = z.infer<typeof ItemSchema>;
export type DriftReportSummary = z.infer<typeof SummarySchema>;
export type DriftSide = z.infer<typeof SideSchema>;
export type Change = z.infer<typeof ChangeSchema>;

/** Raised for a malformed or unknown-version drift report. */
export class DriftReportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DriftReportError";
  }
}

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  ${path}: ${issue.message}`;
  });
  return `invalid drift report:\n${lines.join("\n")}`;
}

/** Validate a value against the drift-report schema. */
export function parseDriftReport(data: unknown): DriftReportDocument {
  const result = DriftReportSchema.safeParse(data);
  if (!result.success) {
    throw new DriftReportError(formatIssues(result.error));
  }
  return result.data;
}

/** Classes a comparison can produce (resolution-error is engine-injected). */
export type ReportableClass =
  "structural" | "semantic" | "missing" | "undeclared";

/** A drift finding awaiting fingerprint + markdown, assembled by the engine. */
export interface DriftEntry {
  tool: string;
  source: string;
  class: ReportableClass;
  locked?: DriftSide;
  live?: DriftSide;
  changes?: Change[];
}

interface RenderableItem {
  fingerprint: string;
  tool: string;
  source: string;
  class: DriftReportItem["class"];
  locked?: DriftSide;
  live?: DriftSide;
  changes: Change[];
}

const CLASS_LABEL: Record<DriftReportItem["class"], string> = {
  structural: "structural drift",
  semantic: "semantic drift",
  missing: "missing",
  undeclared: "undeclared",
  "resolution-error": "resolution error",
};

/** `sha256:abc…` — shortened for human-readable markdown; full hash is in JSON. */
function shortHash(hash: string): string {
  const [algo, hex = ""] = hash.split(":");
  return `${algo ?? ""}:${hex.slice(0, 12)}…`;
}

/** Render one drift item as a self-contained markdown fragment (COMMAND_SPEC §6). */
export function renderItemMarkdown(item: RenderableItem): string {
  const lines: string[] = [
    `### \`${item.tool}\` — ${CLASS_LABEL[item.class]}`,
    `- **Source:** ${item.source}`,
    `- **Fingerprint:** \`${item.fingerprint}\``,
  ];

  switch (item.class) {
    case "structural":
      if (item.locked && item.live) {
        lines.push(
          `- **Schema hash:** \`${shortHash(item.locked.schemaHash)}\` → \`${shortHash(item.live.schemaHash)}\``,
        );
      }
      break;
    case "semantic":
      if (item.locked && item.live) {
        lines.push(
          `- **Semantic hash:** \`${shortHash(item.locked.semanticHash)}\` → \`${shortHash(item.live.semanticHash)}\``,
        );
      }
      lines.push("- Description or annotations changed; schema unchanged.");
      break;
    case "missing":
      lines.push("- Locked but no longer offered by the server.");
      break;
    case "undeclared":
      lines.push("- Offered by the server but not pinned.");
      break;
    case "resolution-error":
      lines.push("- The source could not be resolved.");
      break;
  }

  for (const change of item.changes) {
    const delta =
      change.from !== undefined || change.to !== undefined
        ? ` (\`${JSON.stringify(change.from)}\` → \`${JSON.stringify(change.to)}\`)`
        : "";
    lines.push(`  - \`${change.path}\`: ${change.kind}${delta}`);
  }

  return lines.join("\n");
}

function toItem(entry: DriftEntry): DriftReportItem {
  const fp = fingerprint({
    tool: entry.tool,
    class: entry.class,
    ...(entry.locked && {
      locked: {
        schemaHash: entry.locked.schemaHash,
        semanticHash: entry.locked.semanticHash,
      },
    }),
    ...(entry.live && {
      live: {
        schemaHash: entry.live.schemaHash,
        semanticHash: entry.live.semanticHash,
      },
    }),
  });

  const renderable: RenderableItem = {
    fingerprint: fp,
    tool: entry.tool,
    source: entry.source,
    class: entry.class,
    ...(entry.locked && { locked: entry.locked }),
    ...(entry.live && { live: entry.live }),
    changes: entry.changes ?? [],
  };

  return { ...renderable, markdown: renderItemMarkdown(renderable) };
}

function summarize(items: readonly DriftReportItem[]): DriftReportSummary {
  const summary: DriftReportSummary = {
    structural: 0,
    semantic: 0,
    missing: 0,
    undeclared: 0,
    resolutionErrors: 0,
  };
  for (const item of items) {
    if (item.class === "resolution-error") {
      summary.resolutionErrors += 1;
    } else {
      summary[item.class] += 1;
    }
  }
  return summary;
}

function byToolThenClass(a: DriftReportItem, b: DriftReportItem): number {
  if (a.tool !== b.tool) {
    return a.tool < b.tool ? -1 : 1;
  }
  if (a.class !== b.class) {
    return a.class < b.class ? -1 : 1;
  }
  return 0;
}

export interface BuildDriftReportParams {
  manifest: string;
  /** ISO-8601 UTC; injected (determinism — never a raw clock). */
  generatedAt: string;
  entries: DriftEntry[];
}

/** Assemble a validated drift report from classified entries. */
export function buildDriftReport(
  params: BuildDriftReportParams,
): DriftReportDocument {
  const items = params.entries.map(toItem).sort(byToolThenClass);
  return parseDriftReport({
    schemaVersion: 1,
    generatedAt: params.generatedAt,
    manifest: params.manifest,
    summary: summarize(items),
    items,
  });
}

function summaryLine(summary: DriftReportSummary): string {
  const parts = [
    `${summary.structural} structural`,
    `${summary.semantic} semantic`,
    `${summary.missing} missing`,
    `${summary.undeclared} undeclared`,
  ];
  if (summary.resolutionErrors > 0) {
    const noun = summary.resolutionErrors === 1 ? "error" : "errors";
    parts.push(`${summary.resolutionErrors} resolution ${noun}`);
  }
  return parts.join(", ");
}

/** Render a whole report as markdown (for `verify --report`). */
export function renderReportMarkdown(report: DriftReportDocument): string {
  const header = `# Drift report\n\n${summaryLine(report.summary)}`;
  if (report.items.length === 0) {
    return `${header}\n\nNo drift.\n`;
  }
  const body = report.items.map((item) => item.markdown).join("\n\n");
  return `${header}\n\n${body}\n`;
}
