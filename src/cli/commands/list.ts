import type { Command } from "commander";

import { classifyDrift } from "../../core/drift";
import type { ToolHashes } from "../../core/hash";
import { collectLiveTools, lockedToolHashes } from "../../resolve/engine";
import type { Lockfile } from "../../schema/lockfile";
import { loadManifest } from "../../schema/manifest";
import { EXIT, ExitError } from "../errors";
import { loadLockfile } from "../files";
import type { CliIo, CommandRegistrar } from "../run";

function listOffline(lockfile: Lockfile, json: boolean, io: CliIo): void {
  const rows = Object.entries(lockfile.tools)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tool, entry]) => ({
      tool,
      source: entry.source,
      version: entry.serverVersion ?? null,
      schemaHash: entry.schemaHash,
      semanticHash: entry.semanticHash,
    }));
  if (json) {
    io.out(JSON.stringify(rows));
    return;
  }
  for (const row of rows) {
    const version = row.version !== null ? `@${row.version}` : "";
    io.out(`${row.tool}  ${row.source}${version}`);
  }
}

async function listLive(
  lockfile: Lockfile,
  manifestPath: string,
  json: boolean,
  io: CliIo,
): Promise<void> {
  const manifest = loadManifest(manifestPath);
  const live = await collectLiveTools({
    manifest,
    env: io.env,
    clock: io.clock,
    cwd: io.cwd,
  });
  const liveHashes: Record<string, ToolHashes> = {};
  for (const [name, info] of live) {
    liveHashes[name] = info.hashes;
  }
  const report = classifyDrift(lockedToolHashes(lockfile), liveHashes);
  if (json) {
    io.out(
      JSON.stringify(
        report.items.map((item) => ({ tool: item.tool, status: item.class })),
      ),
    );
    return;
  }
  for (const item of report.items) {
    io.out(`${item.tool}  ${item.class}`);
  }
}

/** `mcplock list` — list pinned tools, offline or with live drift (§4.10). */
export const listCommand: CommandRegistrar = (program, io) => {
  program
    .command("list")
    .description("List pinned tools (with live drift status unless --offline).")
    .option("--offline", "Lockfile only; no network")
    .option("--json", "Machine-readable")
    .action(async (_options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const lockfilePath = String(opts.lockfile);
      const manifestPath = String(opts.manifest);
      const offline = opts.offline === true;
      const json = opts.json === true;

      const lockfile = loadLockfile(lockfilePath);
      if (lockfile === undefined) {
        throw new ExitError(
          EXIT.RESOLUTION,
          `no lockfile at ${lockfilePath}; run \`mcplock resolve\` first`,
        );
      }

      if (offline) {
        listOffline(lockfile, json, io);
      } else {
        await listLive(lockfile, manifestPath, json, io);
      }
    });
};
