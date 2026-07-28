/**
 * Manifest/lockfile file I/O for the CLI commands.
 *
 * Note: writeManifest re-serializes the parsed manifest, so hand-written
 * comments are not preserved across `add`/`remove` — a comment-preserving edit
 * (via the yaml Document AST) is a later enhancement.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { stringify as stringifyYaml } from "yaml";

import {
  parseLockfileText,
  serializeLockfile,
  type Lockfile,
} from "../schema/lockfile";
import type { Manifest } from "../schema/manifest";

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function writeManifest(path: string, manifest: Manifest): void {
  writeFileSync(path, stringifyYaml(manifest), "utf8");
}

export function writeLockfile(path: string, lockfile: Lockfile): void {
  writeFileSync(path, serializeLockfile(lockfile), "utf8");
}

/** Read and validate a lockfile, or undefined if it does not exist. */
export function loadLockfile(path: string): Lockfile | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return parseLockfileText(readFileSync(path, "utf8"));
}
