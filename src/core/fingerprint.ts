/**
 * Drift fingerprints (COMMAND_SPEC §7) — the deduplication contract consumed by
 * mcplock-action.
 *
 * A fingerprint is the first 16 hex chars of sha256 over the RFC 8785 canonical
 * JSON of { tool, class, locked hashes, live hashes }. Guarantees:
 *   - the same unresolved drift yields the same fingerprint on every run/runner;
 *   - any further change to either side yields a new fingerprint;
 *   - resolved drift ceases to be reported, so its fingerprint disappears.
 *
 * Shape decision (frozen contract — confirm before v0.1.0): the spec names the
 * inputs in dotted path notation; we serialize them as NESTED locked/live
 * objects to match the §6 report item, and include ONLY the two hash fields per
 * side (never version) so a version bump with identical hashes does not churn
 * the fingerprint. Absent sides (missing has no live, undeclared has no locked)
 * are dropped by canonicalization.
 */
import { createHash } from "node:crypto";

import { canonicalize } from "./canonical";
import type { ToolDrift } from "./drift";

/** Length of a fingerprint in hex characters (spec §7). */
const FINGERPRINT_HEX = 16;

/** Compute the deduplication fingerprint for a drift item. */
export function fingerprint(item: ToolDrift): string {
  const canonical = canonicalize({
    tool: item.tool,
    class: item.class,
    locked: item.locked
      ? {
          schemaHash: item.locked.schemaHash,
          semanticHash: item.locked.semanticHash,
        }
      : undefined,
    live: item.live
      ? {
          schemaHash: item.live.schemaHash,
          semanticHash: item.live.semanticHash,
        }
      : undefined,
  });
  return createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, FINGERPRINT_HEX);
}
