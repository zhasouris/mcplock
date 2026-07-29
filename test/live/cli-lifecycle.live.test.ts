/**
 * Full CLI lifecycle against a REAL MCP server (NOT the hermetic gate).
 *
 * Exercises the whole mcplock command surface end to end against a live
 * server-everything instance: init -> (declare source) -> add -> why -> list
 * -> verify -> resolve --frozen -> diff -> update --dry-run -> remove.
 *
 * Runs only when MCPLOCK_LIVE=1.
 */
import type { ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { systemClock } from "../../src/core/clock";
import { run, type CliIo } from "../../src/cli/run";
import { McpClient } from "../../src/mcp/client";
import { parseLockfileText } from "../../src/schema/lockfile";
import { EVERYTHING, URL, startServer, stopServer } from "./server-harness";

const LIVE = process.env.MCPLOCK_LIVE === "1";
const VERSION = process.env.MCPLOCK_LIVE_NEW ?? "2026.7.4";

describe.skipIf(!LIVE)("live: full CLI lifecycle (server-everything)", () => {
  let dir: string;
  let server: ChildProcess;
  let tool: string;

  function io(): CliIo & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      stdout,
      stderr,
      out: (t) => stdout.push(t),
      err: (t) => stderr.push(t),
      env: process.env,
      cwd: dir,
      clock: systemClock,
    };
  }

  const mp = (): string => join(dir, "mcp-tools.yaml");
  const lp = (): string => join(dir, "mcp-tools.lock");
  const g = (): string[] => ["--manifest", mp(), "--lockfile", lp()];
  const lockedTools = (): Record<string, unknown> =>
    parseLockfileText(readFileSync(lp(), "utf8")).tools;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "mcplock-cli-live-"));
    server = await startServer(`${EVERYTHING}@${VERSION}`);
    const listed = await new McpClient({ url: URL }).listTools();
    tool = listed.tools[0]!.name;
  }, 200_000);

  afterAll(async () => {
    await stopServer(server);
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs init -> add -> why -> list -> verify -> frozen -> diff -> update -> remove", async () => {
    // init: scaffold an (empty-sources) manifest.
    expect(await run([...g(), "init"], io())).toBe(0);
    expect(existsSync(mp())).toBe(true);

    // The user hand-adds a source (there is no add-source command).
    writeFileSync(
      mp(),
      stringifyYaml({
        version: 1,
        sources: [{ name: "everything", url: URL }],
        tools: [],
      }),
      "utf8",
    );

    // add: declare + resolve + pin the real tool.
    expect(await run([...g(), "add", tool], io())).toBe(0);
    expect(lockedTools()[tool]).toBeDefined();

    // why: explain the pin (real hashes).
    const why = io();
    expect(await run([...g(), "why", tool], why)).toBe(0);
    expect(why.stdout.join("\n")).toContain("schemaHash:    sha256:");

    // list --offline: shows the pinned tool.
    const list = io();
    await run([...g(), "list", "--offline"], list);
    expect(list.stdout.join("\n")).toContain(tool);

    // verify: clean against the same live version.
    expect(await run([...g(), "verify"], io())).toBe(0);

    // resolve --frozen: up to date, writes nothing.
    expect(await run([...g(), "resolve", "--frozen"], io())).toBe(0);

    // diff --tool: the pinned tool has no change (the other live tools are
    // undeclared, expected since we only pinned one).
    const diff = io();
    await run([...g(), "diff", "--tool", tool], diff);
    expect(diff.stdout.join("\n")).toContain("no change");

    // update --dry-run: no changes against the same version.
    const upd = io();
    await run([...g(), "update", tool, "--dry-run"], upd);
    expect(upd.stdout.join("\n")).toContain("no changes");

    // remove: drops the tool from manifest and lockfile.
    expect(await run([...g(), "remove", tool], io())).toBe(0);
    expect(lockedTools()[tool]).toBeUndefined();
  }, 200_000);
});
