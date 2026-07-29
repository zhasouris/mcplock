#!/usr/bin/env node
/**
 * mcplock executable entry — the shebang launcher. Runs the CLI and reflects
 * its exit code onto the process. Deliberately trivial (and coverage-excluded
 * in vitest.config.ts): all real logic lives in cli.ts and run.ts, both tested.
 *
 * No top-level await — it must also bundle to CJS for the standalone binaries.
 */
import { main } from "./cli";

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `mcplock: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 70; // internal error (EXIT.INTERNAL)
  });
