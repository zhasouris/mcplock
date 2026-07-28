import type { Command } from "commander";

import { parseManifest } from "../../schema/manifest";
import { UsageError } from "../errors";
import { fileExists, writeManifest } from "../files";
import type { CommandRegistrar } from "../run";

/** `mcplock init` — scaffold a manifest (COMMAND_SPEC §4.1). */
export const initCommand: CommandRegistrar = (program, io) => {
  program
    .command("init")
    .description("Scaffold a manifest in the current directory.")
    .option(
      "--target <lang>",
      "Codegen target: typescript | dotnet",
      "typescript",
    )
    .option("--output <dir>", "Generated-client directory", "./generated")
    .option("--force", "Overwrite an existing manifest")
    .action((_options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const manifestPath = String(opts.manifest);
      const target = String(opts.target);
      const output = String(opts.output);
      const force = opts.force === true;

      if (target === "dotnet") {
        throw new UsageError(
          "codegen target 'dotnet' is reserved and not yet implemented",
        );
      }
      if (target !== "typescript") {
        throw new UsageError(`unknown codegen target "${target}"`);
      }
      if (fileExists(manifestPath) && !force) {
        throw new UsageError(
          `manifest already exists at ${manifestPath} (use --force to overwrite)`,
        );
      }

      const manifest = parseManifest({
        version: 1,
        sources: [],
        tools: [],
        codegen: { target, output },
      });
      writeManifest(manifestPath, manifest);
      io.out(`Wrote ${manifestPath}`);
    });
};
