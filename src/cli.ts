/**
 * Executable wiring for mcplock: map the Node process onto the injected CliIo
 * seam and run the CLI. Kept separate from bin.ts (the shebang launcher that
 * turns the returned code into a process exit) so this stays unit-testable —
 * the process is injected, and nothing here reads real stdio at import time.
 */
import { run, type CliIo } from "./cli/run";
import { systemClock } from "./core/clock";

/** The process seams the CLI entry touches — injectable for tests. */
export interface ProcessLike {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: () => string;
  stdout: { write: (text: string) => unknown };
  stderr: { write: (text: string) => unknown };
}

/** Map a process onto the CliIo seam — the one impure boundary. */
export function processIo(proc: ProcessLike): CliIo {
  return {
    out: (text) => {
      proc.stdout.write(text);
    },
    err: (text) => {
      proc.stderr.write(text);
    },
    env: proc.env,
    cwd: proc.cwd(),
    clock: systemClock,
  };
}

/** Run the CLI against a process (argv after node + script) and return its code. */
export function main(proc: ProcessLike = process): Promise<number> {
  return run(proc.argv.slice(2), processIo(proc));
}
