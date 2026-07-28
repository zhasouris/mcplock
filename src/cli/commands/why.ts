import type { Command } from "commander";

import { EXIT, ExitError, UsageError } from "../errors";
import { loadLockfile } from "../files";
import type { CommandRegistrar } from "../run";

/** `mcplock why <tool>` — explain a pin (COMMAND_SPEC §4.9). Offline. */
export const whyCommand: CommandRegistrar = (program, io) => {
  program
    .command("why")
    .argument("<tool>", "Tool name")
    .description(
      "Explain a pinned tool: source, version, hashes, scopes, time.",
    )
    .option("--json", "Machine-readable")
    .action((tool: string, _options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const lockfilePath = String(opts.lockfile);
      const json = opts.json === true;

      const lockfile = loadLockfile(lockfilePath);
      if (lockfile === undefined) {
        throw new ExitError(
          EXIT.RESOLUTION,
          `no lockfile at ${lockfilePath}; run \`mcplock resolve\` first`,
        );
      }
      const entry = lockfile.tools[tool];
      if (entry === undefined) {
        throw new UsageError(`tool "${tool}" is not pinned in the lockfile`);
      }

      if (json) {
        io.out(JSON.stringify({ tool, ...entry }));
        return;
      }

      const version =
        entry.serverVersion !== undefined ? ` @ ${entry.serverVersion}` : "";
      io.out(tool);
      io.out(`  source:        ${entry.source}`);
      io.out(`  server:        ${entry.resolvedServer}${version}`);
      io.out(`  schemaHash:    ${entry.schemaHash}`);
      io.out(`  semanticHash:  ${entry.semanticHash}`);
      io.out(
        `  scopes:        ${entry.scopes.length > 0 ? entry.scopes.join(", ") : "(none)"}`,
      );
      io.out(
        `  forwardChain:  ${entry.forwardChain.length > 0 ? entry.forwardChain.join(" → ") : "(reserved)"}`,
      );
      io.out(`  resolvedAt:    ${entry.resolvedAt}`);
    });
};
