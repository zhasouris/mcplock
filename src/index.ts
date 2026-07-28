/**
 * mcplock — lockfiles for MCP tool surfaces.
 *
 * Phase 1 scaffold. The real domain logic (manifest/lockfile schemas, RFC 8785
 * canonicalization, dual hashing, drift classification, fingerprints) lands in
 * the subsequent Phase 1 commits. This entry point exists so the build, test,
 * and coverage harness has something to exercise.
 */

/** Harness smoke value — proves the toolchain wires up end to end. */
export function harnessReady(): string {
  return "mcplock harness ready";
}
