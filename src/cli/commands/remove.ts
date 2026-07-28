import type { Command } from "commander";

import type { LockedTool } from "../../schema/lockfile";
import { loadManifest } from "../../schema/manifest";
import { UsageError } from "../errors";
import { loadLockfile, writeLockfile, writeManifest } from "../files";
import type { CommandRegistrar } from "../run";

/** `mcplock remove <tool>` — drop a tool from manifest + lockfile (COMMAND_SPEC §4.3). */
export const removeCommand: CommandRegistrar = (program, io) => {
  program
    .command("remove")
    .argument("<tool>", "Tool name")
    .description("Remove a tool from the manifest and lockfile.")
    .option("--no-generate", "Skip client regeneration")
    .action((tool: string, _options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const manifestPath = String(opts.manifest);
      const lockfilePath = String(opts.lockfile);

      const manifest = loadManifest(manifestPath);
      if (!manifest.tools.some((t) => t.name === tool)) {
        throw new UsageError(`tool "${tool}" is not declared in the manifest`);
      }
      writeManifest(manifestPath, {
        ...manifest,
        tools: manifest.tools.filter((t) => t.name !== tool),
      });

      const lockfile = loadLockfile(lockfilePath);
      if (lockfile !== undefined) {
        const rest: Record<string, LockedTool> = {};
        for (const [name, entry] of Object.entries(lockfile.tools)) {
          if (name !== tool) rest[name] = entry;
        }
        writeLockfile(lockfilePath, { ...lockfile, tools: rest });
      }
      io.out(`Removed "${tool}"`);
    });
};
