/**
 * Drift classification (COMMAND_SPEC §6) — compare the locked tool set against
 * the live tool set and label each tool.
 *
 * Per tool, over the union of locked and live names:
 *   - **structural** — present both sides, structural (schema) hash differs.
 *     Structural dominates: if both hashes differ it is still structural, the
 *     higher-severity signal (exit 1 beats exit 2, spec §3).
 *   - **semantic**   — present both sides, schema hash matches, semantic differs.
 *   - **missing**    — locked but no longer live (removed upstream).
 *   - **undeclared** — live but not locked (present upstream, not pinned). A
 *     warning, never a failure (spec §4.4).
 *   - **clean**      — present both sides, both hashes match.
 *
 * `resolution-error` is not produced here — it is injected by the engine when a
 * source cannot be fetched, not derived from a tool-set comparison.
 */
import type { ToolHashes } from "./hash";

export type DriftClass =
  "clean" | "structural" | "semantic" | "missing" | "undeclared";

export interface ToolDrift {
  tool: string;
  class: DriftClass;
  /** Absent for `undeclared` (nothing was pinned). */
  locked?: ToolHashes;
  /** Absent for `missing` (nothing is live). */
  live?: ToolHashes;
}

export interface DriftSummary {
  clean: number;
  structural: number;
  semantic: number;
  missing: number;
  undeclared: number;
}

export interface DriftReport {
  /** One entry per tool, sorted by tool name for deterministic output. */
  items: ToolDrift[];
  summary: DriftSummary;
}

/** Classify locked vs live tool hashes. */
export function classifyDrift(
  locked: Record<string, ToolHashes>,
  live: Record<string, ToolHashes>,
): DriftReport {
  const summary: DriftSummary = {
    clean: 0,
    structural: 0,
    semantic: 0,
    missing: 0,
    undeclared: 0,
  };
  const items: ToolDrift[] = [];

  const names = new Set([...Object.keys(locked), ...Object.keys(live)]);
  for (const tool of [...names].sort()) {
    const lockedHashes = locked[tool];
    const liveHashes = live[tool];

    if (lockedHashes !== undefined && liveHashes !== undefined) {
      const driftClass: DriftClass =
        lockedHashes.schemaHash !== liveHashes.schemaHash
          ? "structural"
          : lockedHashes.semanticHash !== liveHashes.semanticHash
            ? "semantic"
            : "clean";
      items.push({
        tool,
        class: driftClass,
        locked: lockedHashes,
        live: liveHashes,
      });
      summary[driftClass] += 1;
    } else if (lockedHashes !== undefined) {
      items.push({ tool, class: "missing", locked: lockedHashes });
      summary.missing += 1;
    } else if (liveHashes !== undefined) {
      items.push({ tool, class: "undeclared", live: liveHashes });
      summary.undeclared += 1;
    }
  }

  return { items, summary };
}
