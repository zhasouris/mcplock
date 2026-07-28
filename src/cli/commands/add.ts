import type { Command } from "commander";

import { resolve } from "../../resolve/engine";
import { loadManifest, type Manifest } from "../../schema/manifest";
import { VERSION } from "../../version";
import { UsageError } from "../errors";
import { writeLockfile, writeManifest } from "../files";
import type { CommandRegistrar } from "../run";

function pickSource(manifest: Manifest, source: string | undefined): string {
  if (source !== undefined) {
    if (!manifest.sources.some((s) => s.name === source)) {
      throw new UsageError(`unknown source "${source}"`);
    }
    return source;
  }
  if (manifest.sources.length === 0) {
    throw new UsageError(
      "no sources in the manifest; add a source before adding tools",
    );
  }
  if (manifest.sources.length > 1) {
    const names = manifest.sources.map((s) => s.name).join(", ");
    throw new UsageError(
      `multiple sources; specify --source (one of ${names})`,
    );
  }
  return manifest.sources[0]!.name;
}

/** `mcplock add <tool>` — declare, resolve, and pin a tool (COMMAND_SPEC §4.2). */
export const addCommand: CommandRegistrar = (program, io) => {
  program
    .command("add")
    .argument("<tool>", "Tool name as exposed by the server")
    .description("Declare a tool, resolve it, and update the lockfile.")
    .option("--source <name>", "Providing source (required if >1 source)")
    .option("--constraint <semver>", "Version constraint", "*")
    .option("--no-generate", "Skip client regeneration")
    .action(async (tool: string, _options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const manifestPath = String(opts.manifest);
      const lockfilePath = String(opts.lockfile);
      const constraint = String(opts.constraint);
      const source =
        opts.source !== undefined ? String(opts.source) : undefined;

      const manifest = loadManifest(manifestPath);
      const sourceName = pickSource(manifest, source);

      // Idempotent: replace any existing declaration of the same tool.
      const tools = manifest.tools.filter((t) => t.name !== tool);
      tools.push({ name: tool, source: sourceName, constraint });
      const updated: Manifest = { ...manifest, tools };

      // Resolve BEFORE writing so an unknown tool (near-miss error) leaves the
      // manifest untouched.
      const result = await resolve({
        manifest: updated,
        env: io.env,
        clock: io.clock,
        cwd: io.cwd,
        generatedBy: `mcplock@${VERSION}`,
      });

      writeManifest(manifestPath, updated);
      writeLockfile(lockfilePath, result.lockfile);
      for (const warning of result.warnings) io.err(warning);
      io.out(`Added "${tool}" from source "${sourceName}"`);
    });
};
