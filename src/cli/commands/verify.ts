import type { Command } from "commander";

import { classifyDrift, type ToolDrift } from "../../core/drift";
import { msToIso } from "../../core/clock";
import type { ToolHashes } from "../../core/hash";
import {
  collectLiveTools,
  lockedToolHashes,
  type LiveToolInfo,
} from "../../resolve/engine";
import {
  buildDriftReport,
  renderReportMarkdown,
  type DriftEntry,
} from "../../report/drift-report";
import type { Lockfile } from "../../schema/lockfile";
import { loadManifest } from "../../schema/manifest";
import { EXIT, ExitError, UsageError } from "../errors";
import { loadLockfile, writeTextFile } from "../files";
import type { CommandRegistrar } from "../run";

const SEMANTIC_MODES = ["warn", "fail", "ignore"];

/** Turn classified drift + lockfile + live info into §6 report entries. */
function toDriftEntries(
  items: ToolDrift[],
  lockfile: Lockfile,
  live: Map<string, LiveToolInfo>,
): DriftEntry[] {
  const entries: DriftEntry[] = [];
  for (const item of items) {
    if (item.class === "clean") {
      continue;
    }
    const locked = lockfile.tools[item.tool];
    const liveInfo = live.get(item.tool);
    const entry: DriftEntry = {
      tool: item.tool,
      source: locked?.source ?? liveInfo?.source ?? "unknown",
      class: item.class,
    };
    if (item.locked !== undefined) {
      entry.locked = {
        schemaHash: item.locked.schemaHash,
        semanticHash: item.locked.semanticHash,
        ...(locked?.serverVersion !== undefined && {
          version: locked.serverVersion,
        }),
      };
    }
    if (item.live !== undefined) {
      entry.live = {
        schemaHash: item.live.schemaHash,
        semanticHash: item.live.semanticHash,
        ...(liveInfo?.version !== undefined && { version: liveInfo.version }),
      };
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * `mcplock verify` — read-only CI check (COMMAND_SPEC §4.5).
 *
 * Exit codes (§3): structural drift or a missing tool → 1; semantic drift → 2
 * only under `--semantic fail`; clean → 0. Structural beats semantic (1 > 2).
 * Requested reports (--json / --report / --report-json) are emitted BEFORE the
 * exit code is decided, so they are written even on non-zero exit.
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
    .option("--json", "Drift report JSON on stdout")
    .option("--report <path>", "Write a markdown drift report to a file")
    .option("--report-json <path>", "Write the §6 drift report JSON to a file")
    .action(async (_options: unknown, command: Command) => {
      const opts = command.optsWithGlobals();
      const manifestPath = String(opts.manifest);
      const lockfilePath = String(opts.lockfile);
      const semantic = String(opts.semantic);
      const json = opts.json === true;
      const reportPath =
        opts.report !== undefined ? String(opts.report) : undefined;
      const reportJsonPath =
        opts.reportJson !== undefined ? String(opts.reportJson) : undefined;

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
      const document = buildDriftReport({
        manifest: manifestPath,
        generatedAt: msToIso(io.clock()),
        entries: toDriftEntries(report.items, lockfile, live),
      });

      // Emit requested reports first — they must exist even on non-zero exit.
      if (reportPath !== undefined) {
        writeTextFile(reportPath, renderReportMarkdown(document));
      }
      if (reportJsonPath !== undefined) {
        writeTextFile(reportJsonPath, `${JSON.stringify(document, null, 2)}\n`);
      }
      if (json) {
        io.out(JSON.stringify(document));
      } else {
        for (const item of report.items) {
          if (item.class !== "clean") {
            io.out(`${item.class}\t${item.tool}`);
          }
        }
      }

      const { summary } = report;
      const breaking = summary.structural + summary.missing;
      if (breaking > 0) {
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
      if (!json) {
        io.out("verify: no breaking drift");
      }
    });
};
