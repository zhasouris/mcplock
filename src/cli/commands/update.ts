import type { Command } from "commander";

import { resolve } from "../../resolve/engine";
import { parseLockfile, type Lockfile } from "../../schema/lockfile";
import { loadManifest, type Manifest } from "../../schema/manifest";
import { VERSION } from "../../version";
import { UsageError } from "../errors";
import { loadLockfile, writeLockfile } from "../files";
import type { CliIo, CommandRegistrar } from "../run";

interface LockChange {
  tool: string;
  kind: "added" | "changed" | "removed";
}

/** Meaningful (hash-level) changes between two lockfiles; ignores resolvedAt. */
function lockChanges(
  previous: Lockfile | undefined,
  next: Lockfile,
): LockChange[] {
  const changes: LockChange[] = [];
  const names = new Set([
    ...Object.keys(previous?.tools ?? {}),
    ...Object.keys(next.tools),
  ]);
  for (const name of [...names].sort()) {
    const before = previous?.tools[name];
    const after = next.tools[name];
    if (before === undefined && after !== undefined) {
      changes.push({ tool: name, kind: "added" });
    } else if (before !== undefined && after === undefined) {
      changes.push({ tool: name, kind: "removed" });
    } else if (
      before !== undefined &&
      after !== undefined &&
      (before.schemaHash !== after.schemaHash ||
        before.semanticHash !== after.semanticHash)
    ) {
      changes.push({ tool: name, kind: "changed" });
    }
  }
  return changes;
}

async function repinOne(
  manifest: Manifest,
  tool: string,
  existing: Lockfile | undefined,
  io: CliIo,
): Promise<Lockfile> {
  const declared = manifest.tools.find((t) => t.name === tool);
  if (declared === undefined) {
    throw new UsageError(`tool "${tool}" is not declared in the manifest`);
  }
  const filtered: Manifest = {
    ...manifest,
    sources: manifest.sources.filter((s) => s.name === declared.source),
    tools: manifest.tools.filter((t) => t.name === tool),
  };
  const result = await resolve({
    manifest: filtered,
    env: io.env,
    clock: io.clock,
    cwd: io.cwd,
    generatedBy: `mcplock@${VERSION}`,
  });
  const fresh = result.lockfile.tools[tool];
  // Other entries come from `existing` verbatim -> byte-identical.
  return parseLockfile({
    schemaVersion: 1,
    generatedBy: result.lockfile.generatedBy,
    tools: {
      ...(existing?.tools ?? {}),
      ...(fresh !== undefined ? { [tool]: fresh } : {}),
    },
  });
}

/** `mcplock update [tool]` — deliberate re-pin (COMMAND_SPEC §4.7). */
export const updateCommand: CommandRegistrar = (program, io) => {
  program
    .command("update")
    .argument("[tool]", "Restrict to one tool")
    .description("Re-pin to the current live definitions.")
    .option("--dry-run", "Report what would change; write nothing")
    .option("--no-generate", "Skip client regeneration")
    .action(
      async (tool: string | undefined, _options: unknown, command: Command) => {
        const opts = command.optsWithGlobals();
        const manifestPath = String(opts.manifest);
        const lockfilePath = String(opts.lockfile);
        const dryRun = opts.dryRun === true;

        const manifest = loadManifest(manifestPath);
        const existing = loadLockfile(lockfilePath);

        let next: Lockfile;
        if (tool !== undefined) {
          next = await repinOne(manifest, tool, existing, io);
        } else {
          const result = await resolve({
            manifest,
            env: io.env,
            clock: io.clock,
            cwd: io.cwd,
            generatedBy: `mcplock@${VERSION}`,
          });
          next = result.lockfile;
        }

        const changes = lockChanges(existing, next);
        if (changes.length === 0) {
          io.out("update: no changes");
        } else {
          for (const change of changes) {
            io.out(`${change.kind}\t${change.tool}`);
          }
        }

        if (dryRun) {
          io.out("(dry run — nothing written)");
          return;
        }
        writeLockfile(lockfilePath, next);
      },
    );
};
