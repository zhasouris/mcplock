/**
 * CLI harness (PLAN Phase 2, commit 7) — commander wiring, global options, and
 * exit-code mapping. Commands are registered by injected registrars so the
 * harness is testable in isolation; the real command set grows in later commits.
 *
 * run() never calls process.exit — it returns the exit code so it is fully
 * testable; the bin entry (Phase 5) turns that code into an exit.
 */
import { Command, CommanderError } from "commander";

import type { Clock } from "../core/clock";
import { VERSION } from "../version";
import { commandRegistrars } from "./commands";
import { EXIT, exitCodeFor } from "./errors";

/** Global option defaults (COMMAND_SPEC §2). */
export const DEFAULT_MANIFEST = "./mcp-tools.yaml";
export const DEFAULT_LOCKFILE = "./mcp-tools.lock";

/** Ambient dependencies, injected so the CLI is deterministic and testable. */
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  clock: Clock;
}

/** Registers one or more commands onto the root program. */
export type CommandRegistrar = (program: Command, io: CliIo) => void;

/** The real command set (init/add/remove now; resolve/list/... land next). */
export const DEFAULT_REGISTRARS: CommandRegistrar[] = commandRegistrars;

export function buildProgram(
  io: CliIo,
  registrars: CommandRegistrar[],
): Command {
  const program = new Command();
  program
    .name("mcplock")
    .description("Lockfiles for MCP tool surfaces.")
    .version(VERSION)
    .option("--manifest <path>", "Manifest location", DEFAULT_MANIFEST)
    .option("--lockfile <path>", "Lockfile location", DEFAULT_LOCKFILE)
    .option("--verbose", "Debug logging to stderr")
    .option("--quiet", "Errors and final result only")
    .option("--no-color", "Disable ANSI colour");
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => io.out(text),
    writeErr: (text) => io.err(text),
  });
  for (const register of registrars) {
    register(program, io);
  }
  return program;
}

function handleError(error: unknown, io: CliIo): number {
  const code = exitCodeFor(error);
  // Commander already writes its own error/help output via configureOutput.
  if (!(error instanceof CommanderError)) {
    io.err(error instanceof Error ? error.message : String(error));
  }
  return code;
}

/** Parse argv (without node/script) and return the exit code. */
export async function run(
  argv: string[],
  io: CliIo,
  registrars: CommandRegistrar[] = DEFAULT_REGISTRARS,
): Promise<number> {
  const program = buildProgram(io, registrars);
  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT.SUCCESS;
  } catch (error) {
    return handleError(error, io);
  }
}
