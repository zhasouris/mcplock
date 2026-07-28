import type { Command } from "commander";

import { classifyDrift } from "../../core/drift";
import type { ToolHashes } from "../../core/hash";
import { collectLiveTools, lockedToolHashes } from "../../resolve/engine";
import { loadManifest } from "../../schema/manifest";
import { EXIT, ExitError } from "../errors";
import { loadLockfile } from "../files";
import type { CliIo, CommandRegistrar } from "../run";

function short(hash: string): string {
  const [algo, hex = ""] = hash.split(":");
  return `${algo ?? ""}:${hex.slice(0, 12)}…`;
}

/**
 * `mcplock diff` — verify for humans (COMMAND_SPEC §4.8). Always exits 0 unless
 * resolution fails. The lockfile stores hashes, not schemas, so this shows
 * class + hash before→after, not path-level changes (see the phase notes).
 */
export const diffCommand: CommandRegistrar = (program, io) => {
  program
    .command("diff")
    .description("Human-readable live-vs-lock report (never fails on drift).")
    .option("--tool <name>", "Restrict to one tool")
    .option("--semantic-only", "Semantic (description/title) changes only")
    .action(async (_options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const lockfilePath = String(opts.lockfile);
      const manifestPath = String(opts.manifest);
      const toolFilter =
        opts.tool !== undefined ? String(opts.tool) : undefined;
      const semanticOnly = opts.semanticOnly === true;

      const lockfile = loadLockfile(lockfilePath);
      if (lockfile === undefined) {
        throw new ExitError(
          EXIT.RESOLUTION,
          `no lockfile at ${lockfilePath}; run \`mcplock resolve\` first`,
        );
      }
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
      let items = report.items.filter((i) => i.class !== "clean");
      if (toolFilter !== undefined) {
        items = items.filter((i) => i.tool === toolFilter);
      }
      if (semanticOnly) {
        items = items.filter((i) => i.class === "semantic");
      }

      if (items.length === 0) {
        io.out(
          toolFilter !== undefined ? `${toolFilter}: no change` : "No drift.",
        );
        return;
      }

      for (const item of items) {
        printItem(item.class, item.tool, item.locked, item.live, io);
      }
    });
};

function printItem(
  driftClass: string,
  tool: string,
  locked: ToolHashes | undefined,
  live: ToolHashes | undefined,
  io: CliIo,
): void {
  switch (driftClass) {
    case "structural":
      io.out(
        `~ ${tool}  structural  ${short(locked!.schemaHash)} → ${short(live!.schemaHash)}`,
      );
      break;
    case "semantic":
      io.out(
        `~ ${tool}  semantic  ${short(locked!.semanticHash)} → ${short(live!.semanticHash)}`,
      );
      break;
    case "missing":
      io.out(`- ${tool}  missing (removed upstream)`);
      break;
    default:
      io.out(`+ ${tool}  undeclared (offered, not pinned)`);
  }
}
