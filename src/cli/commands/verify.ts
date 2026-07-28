import type { Command } from "commander";

import { classifyDrift } from "../../core/drift";
import type { ToolHashes } from "../../core/hash";
import { collectLiveTools, lockedToolHashes } from "../../resolve/engine";
import { loadManifest } from "../../schema/manifest";
import { EXIT, ExitError, UsageError } from "../errors";
import { loadLockfile } from "../files";
import type { CommandRegistrar } from "../run";

const SEMANTIC_MODES = ["warn", "fail", "ignore"];

/**
 * `mcplock verify` — read-only CI check (COMMAND_SPEC §4.5).
 *
 * Exit codes (§3): structural drift or a missing tool → 1; semantic drift → 2
 * only under `--semantic fail`; clean → 0. Structural beats semantic (1 > 2).
 * Resolution failures (unreachable source, auth) surface as exit 3 via the
 * McpError/AuthError harness mapping.
 */
export const verifyCommand: CommandRegistrar = (program, io) => {
  program
    .command("verify")
    .description(
      "CI check: re-fetch live definitions and compare to the lockfile.",
    )
    .option(
      "--semantic <mode>",
      "How to treat semantic drift: warn|fail|ignore",
      "warn",
    )
    .action(async (_options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const manifestPath = String(opts.manifest);
      const lockfilePath = String(opts.lockfile);
      const semantic = String(opts.semantic);
      if (!SEMANTIC_MODES.includes(semantic)) {
        throw new UsageError("--semantic must be one of warn|fail|ignore");
      }

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
      for (const item of report.items) {
        if (item.class !== "clean") {
          io.out(`${item.class}\t${item.tool}`);
        }
      }

      const { summary } = report;
      const breaking = summary.structural + summary.missing;
      if (breaking > 0) {
        // Structural beats semantic (§3): exit 1 even if semantic also changed.
        throw new ExitError(
          EXIT.STRUCTURAL,
          `${String(breaking)} breaking change(s) (structural or missing)`,
        );
      }
      if (summary.semantic > 0) {
        if (semantic === "fail") {
          throw new ExitError(
            EXIT.SEMANTIC,
            `${String(summary.semantic)} semantic change(s)`,
          );
        }
        if (semantic === "warn") {
          io.err(
            `warning: ${String(summary.semantic)} semantic change(s) — schema unchanged`,
          );
        }
      }
      io.out("verify: no breaking drift");
    });
};
