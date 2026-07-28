/**
 * CLI error taxonomy and exit codes (COMMAND_SPEC §3).
 *
 *   0  success / clean
 *   1  structural drift, or check-generated mismatch
 *   2  semantic drift under --semantic fail
 *   3  resolution error (source unreachable, auth failure, malformed files)
 *   64 usage error (unknown command, bad flags, missing required argument)
 *
 * 70 (EX_SOFTWARE) is used for genuinely unexpected internal errors — outside
 * the spec's documented outcomes, so a bug never masquerades as a real result.
 */
import { CommanderError } from "commander";

export const EXIT = {
  SUCCESS: 0,
  STRUCTURAL: 1,
  SEMANTIC: 2,
  RESOLUTION: 3,
  USAGE: 64,
  INTERNAL: 70,
} as const;

/** Thrown by a command to exit with a specific code (e.g. drift → 1/2). */
export class ExitError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ExitError";
  }
}

/** A usage error raised by command logic (maps to 64). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Domain errors from across the codebase, all mapping to exit 3. */
const RESOLUTION_ERROR_NAMES = new Set([
  "ManifestError",
  "LockfileError",
  "AuthError",
  "McpError",
  "ResolveError",
  "DriftReportError",
]);

/** Map any thrown value to its exit code (COMMAND_SPEC §3). */
export function exitCodeFor(error: unknown): number {
  if (error instanceof ExitError) {
    return error.code;
  }
  if (error instanceof CommanderError) {
    // Help/version exit 0; every other commander error is a usage error.
    return error.exitCode === 0 ? EXIT.SUCCESS : EXIT.USAGE;
  }
  if (error instanceof UsageError) {
    return EXIT.USAGE;
  }
  if (error instanceof Error && RESOLUTION_ERROR_NAMES.has(error.name)) {
    return EXIT.RESOLUTION;
  }
  return EXIT.INTERNAL;
}
