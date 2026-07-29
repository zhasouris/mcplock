/**
 * Lockfile schema and deterministic serializer — `mcp-tools.lock`
 * (COMMAND_SPEC §5.2).
 *
 * The lockfile is machine-generated but human-reviewed: it is pretty-printed
 * JSON with a stable key order so diffs are meaningful, and it is deterministic
 * — identical inputs produce byte-identical files (CLAUDE.md, spec §5.2). Zod is
 * the single source of truth; every read goes through {@link parseLockfile}.
 *
 * Note: this pretty-printed form is distinct from the RFC 8785 canonical JSON
 * used for hashing (spec §7, next commit) — that is compact and for digests,
 * this is indented and for review.
 */
import { z } from "zod";

/** `sha256:<64 lowercase hex>` (COMMAND_SPEC §7). */
const HASH = /^sha256:[0-9a-f]{64}$/;

const HashSchema = z
  .string()
  .regex(HASH, "hash must be sha256:<64 lowercase hex>");

const LockedToolSchema = z
  .object({
    source: z.string().min(1, "locked tool source is required"),
    resolvedServer: z.string().url("resolvedServer must be a valid URL"),
    serverVersion: z.string().optional(),
    schemaHash: HashSchema,
    semanticHash: HashSchema,
    scopes: z.array(z.string()).default([]),
    // Reserved (COMMAND_SPEC §10) — always [] in v1.
    forwardChain: z.array(z.string()).default([]),
    resolvedAt: z
      .string()
      .datetime("resolvedAt must be an ISO-8601 UTC datetime"),
  })
  .strict();

/**
 * Consumers must reject unknown `schemaVersion` (spec §6) — the `literal(1)`
 * enforces that here.
 */
export const LockfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedBy: z.string().min(1, "generatedBy is required"),
    tools: z.record(z.string(), LockedToolSchema),
  })
  .strict();

export type Lockfile = z.infer<typeof LockfileSchema>;
export type LockedTool = z.infer<typeof LockedToolSchema>;

/** Raised for any unreadable, malformed, or invalid lockfile (maps to exit 3). */
export class LockfileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LockfileError";
  }
}

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  ${path}: ${issue.message}`;
  });
  return `invalid lockfile:\n${lines.join("\n")}`;
}

/** Validate an already-parsed value against the lockfile schema. */
export function parseLockfile(data: unknown): Lockfile {
  const result = LockfileSchema.safeParse(data);
  if (!result.success) {
    throw new LockfileError(formatIssues(result.error));
  }
  return result.data;
}

/** JSON-parse then validate lockfile text. */
export function parseLockfileText(text: string): Lockfile {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new LockfileError("lockfile is not valid JSON", { cause });
  }
  return parseLockfile(data);
}

/**
 * Build a locked-tool object with keys in the fixed canonical order. `undefined`
 * fields (e.g. an absent serverVersion) are dropped by JSON.stringify.
 */
function canonicalTool(tool: LockedTool): Record<string, unknown> {
  return {
    source: tool.source,
    resolvedServer: tool.resolvedServer,
    serverVersion: tool.serverVersion,
    schemaHash: tool.schemaHash,
    semanticHash: tool.semanticHash,
    scopes: tool.scopes,
    forwardChain: tool.forwardChain,
    resolvedAt: tool.resolvedAt,
  };
}

/**
 * Serialize deterministically: tool names sorted lexicographically, fixed field
 * order within each entry, 2-space indent, trailing newline. Array order
 * (scopes, forwardChain) is preserved — normalizing it is a resolve-time
 * concern, not the serializer's.
 */
export function serializeLockfile(lockfile: Lockfile): string {
  const tools: Record<string, unknown> = {};
  for (const name of Object.keys(lockfile.tools).sort()) {
    // Non-null: name comes from Object.keys(lockfile.tools).
    tools[name] = canonicalTool(lockfile.tools[name]!);
  }

  const canonical = {
    schemaVersion: lockfile.schemaVersion,
    generatedBy: lockfile.generatedBy,
    tools,
  };

  return `${JSON.stringify(canonical, null, 2)}\n`;
}
