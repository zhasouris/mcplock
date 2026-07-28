/**
 * Dual tool hashing (COMMAND_SPEC §7).
 *
 * Two independent digests per tool, each sha256 over the RFC 8785 canonical
 * JSON of a fixed field set:
 *
 *   - **structural** — { name, inputSchema, outputSchema, annotations }.
 *     Annotations (readOnlyHint, destructiveHint, …) are structural: they gate
 *     behaviour, so a change to one must move the structural hash.
 *   - **semantic** — { title, description }. This is the drift no schema
 *     validator sees: a reworded description that changes tool selection.
 *
 * Because canonicalization sorts keys, both hashes are stable under input key
 * reordering — reordering inputSchema properties does not move the hash.
 */
import { createHash } from "node:crypto";

import { canonicalize } from "./canonical";

/** A tool definition as returned by an MCP server's `tools/list`. */
export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

/** The two hashes recorded per tool in the lockfile. */
export interface ToolHashes {
  /** Structural digest — lockfile field `schemaHash`. */
  schemaHash: string;
  /** Semantic digest — lockfile field `semanticHash`. */
  semanticHash: string;
}

function sha256(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
}

/** sha256 over canonical { name, inputSchema, outputSchema, annotations }. */
export function structuralHash(tool: ToolDefinition): string {
  return sha256(
    canonicalize({
      name: tool.name,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    }),
  );
}

/** sha256 over canonical { title, description }. */
export function semanticHash(tool: ToolDefinition): string {
  return sha256(
    canonicalize({
      title: tool.title,
      description: tool.description,
    }),
  );
}

/** Both hashes for a tool, keyed as they appear in the lockfile. */
export function hashTool(tool: ToolDefinition): ToolHashes {
  return {
    schemaHash: structuralHash(tool),
    semanticHash: semanticHash(tool),
  };
}
