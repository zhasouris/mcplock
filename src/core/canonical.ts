/**
 * RFC 8785 (JSON Canonicalization Scheme) canonical JSON (COMMAND_SPEC §7).
 *
 * Produces the deterministic byte-string that the structural and semantic
 * hashes digest (next commit). Canonical JSON is:
 *   - object keys sorted by UTF-16 code unit, recursively;
 *   - no insignificant whitespace;
 *   - ECMAScript number serialization (shortest round-trippable form);
 *   - minimal JSON string escaping (short escapes + \\uXXXX for C0 controls,
 *     every other character emitted literally as UTF-8).
 *
 * Implementation note: we serialize objects by hand rather than sorting keys
 * into a new object and calling JSON.stringify, because JavaScript reorders
 * integer-like keys ("10" before "2") regardless of insertion order — which
 * would violate JCS's code-unit ordering. Per-scalar we reuse JSON.stringify:
 * its number and string escaping already match RFC 8785 exactly.
 */

/** Raised when a value cannot be represented as canonical JSON. */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/** Serialize a JSON value to its RFC 8785 canonical form. */
export function canonicalize(value: unknown): string {
  return write(value);
}

function write(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          `non-finite number cannot be canonicalized: ${String(value)}`,
        );
      }
      // ECMAScript Number serialization == RFC 8785 §3.2.2.3.
      return JSON.stringify(value);
    case "string":
      // JSON.stringify's minimal escaping == RFC 8785 §3.2.2.2.
      return JSON.stringify(value);
    case "object":
      return Array.isArray(value)
        ? writeArray(value)
        : writeObject(value as Record<string, unknown>);
    default:
      // undefined, bigint, function, symbol
      throw new CanonicalizationError(
        `value of type ${typeof value} cannot be canonicalized`,
      );
  }
}

/** JSON.stringify drops undefined/function/symbol array holes to null. */
function isJsonHole(value: unknown): boolean {
  const type = typeof value;
  return value === undefined || type === "function" || type === "symbol";
}

function writeArray(array: readonly unknown[]): string {
  const items = array.map((item) => (isJsonHole(item) ? "null" : write(item)));
  return `[${items.join(",")}]`;
}

function writeObject(object: Record<string, unknown>): string {
  const parts: string[] = [];
  // Default Array#sort compares by UTF-16 code unit — exactly JCS key ordering.
  for (const key of Object.keys(object).sort()) {
    const value = object[key];
    // JSON.stringify omits undefined/function/symbol-valued properties.
    if (isJsonHole(value)) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${write(value)}`);
  }
  return `{${parts.join(",")}}`;
}
