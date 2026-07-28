import type { Command } from "commander";

import { resolve } from "../../resolve/engine";
import { parseLockfile, type Lockfile } from "../../schema/lockfile";
import { loadManifest, type Manifest } from "../../schema/manifest";
import { VERSION } from "../../version";
import { UsageError } from "../errors";
import { loadLockfile, writeLockfile } from "../files";
import type { CliIo, CommandRegistrar } from "../run";

async function resolveAll(
  manifest: Manifest,
  io: CliIo,
): Promise<{ lockfile: Lockfile; warnings: string[] }> {
  const result = await resolve({
    manifest,
    env: io.env,
    clock: io.clock,
    cwd: io.cwd,
    generatedBy: `mcplock@${VERSION}`,
  });
  return { lockfile: result.lockfile, warnings: result.warnings };
}

async function resolveOneSource(
  manifest: Manifest,
  sourceName: string,
  lockfilePath: string,
  io: CliIo,
): Promise<{ lockfile: Lockfile; warnings: string[] }> {
  if (!manifest.sources.some((s) => s.name === sourceName)) {
    throw new UsageError(`unknown source "${sourceName}"`);
  }
  const filtered: Manifest = {
    ...manifest,
    sources: manifest.sources.filter((s) => s.name === sourceName),
    tools: manifest.tools.filter((t) => t.source === sourceName),
  };
  const { lockfile, warnings } = await resolveAll(filtered, io);
  // Preserve existing pins for the other sources.
  const existing = loadLockfile(lockfilePath);
  const merged = parseLockfile({
    schemaVersion: 1,
    generatedBy: lockfile.generatedBy,
    tools: { ...(existing?.tools ?? {}), ...lockfile.tools },
  });
  return { lockfile: merged, warnings };
}

/** `mcplock resolve` — full resolution → lockfile (COMMAND_SPEC §4.4). */
export const resolveCommand: CommandRegistrar = (program, io) => {
  program
    .command("resolve")
    .description("Resolve every source and write the lockfile.")
    .option("--source <name>", "Restrict to one source")
    .option("--no-generate", "Lockfile only")
    .option("--json", "Machine-readable resolution report on stdout")
    .action(async (_options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const manifestPath = String(opts.manifest);
      const lockfilePath = String(opts.lockfile);
      const json = opts.json === true;
      const source =
        opts.source !== undefined ? String(opts.source) : undefined;

      const manifest = loadManifest(manifestPath);
      const { lockfile, warnings } =
        source !== undefined
          ? await resolveOneSource(manifest, source, lockfilePath, io)
          : await resolveAll(manifest, io);

      writeLockfile(lockfilePath, lockfile);

      const toolNames = Object.keys(lockfile.tools);
      if (json) {
        io.out(JSON.stringify({ tools: toolNames, warnings }));
      } else {
        for (const warning of warnings) io.err(warning);
        io.out(`Wrote ${lockfilePath} (${String(toolNames.length)} tools)`);
      }
    });
};
