import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { McpFixtureServer } from "../../../test/mcp/fixture-server";
import type { Clock } from "../../core/clock";
import { loadManifest } from "../../schema/manifest";
import { parseLockfileText } from "../../schema/lockfile";
import { run, type CliIo } from "../run";

const clock: Clock = () => 1_700_000_000_000;

let dir: string;
let fixture: McpFixtureServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcplock-cli-"));
  fixture = await McpFixtureServer.start();
});

afterEach(async () => {
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

function io(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    env: {},
    cwd: dir,
    clock,
  };
}

const manifestPath = () => join(dir, "mcp-tools.yaml");
const lockfilePath = () => join(dir, "mcp-tools.lock");

/** Global options must precede the subcommand (commander). */
function globals(): string[] {
  return ["--manifest", manifestPath(), "--lockfile", lockfilePath()];
}

function writeManifestFile(
  sources: { name: string; url: string }[],
  tools: { name: string; source: string }[] = [],
): void {
  writeFileSync(
    manifestPath(),
    stringifyYaml({ version: 1, sources, tools }),
    "utf8",
  );
}

function readLockfileTools(): Record<string, unknown> {
  return parseLockfileText(readFileSync(lockfilePath(), "utf8")).tools;
}

describe("init", () => {
  it("scaffolds a manifest", async () => {
    const code = await run([...globals(), "init"], io());
    expect(code).toBe(0);
    expect(existsSync(manifestPath())).toBe(true);
    expect(loadManifest(manifestPath()).codegen?.target).toBe("typescript");
  });

  it("refuses to overwrite without --force", async () => {
    await run([...globals(), "init"], io());
    expect(await run([...globals(), "init"], io())).toBe(64);
  });

  it("overwrites with --force", async () => {
    await run([...globals(), "init"], io());
    expect(await run([...globals(), "init", "--force"], io())).toBe(0);
  });

  it("rejects the reserved dotnet target", async () => {
    expect(await run([...globals(), "init", "--target", "dotnet"], io())).toBe(
      64,
    );
  });

  it("rejects an unknown target", async () => {
    expect(await run([...globals(), "init", "--target", "python"], io())).toBe(
      64,
    );
  });
});

describe("add", () => {
  it("declares, resolves, and pins a tool", async () => {
    writeManifestFile([{ name: "src", url: fixture.url }]);
    fixture.setTools([{ name: "a.tool" }]);

    const code = await run([...globals(), "add", "a.tool"], io());

    expect(code).toBe(0);
    expect(loadManifest(manifestPath()).tools.map((t) => t.name)).toEqual([
      "a.tool",
    ]);
    expect(readLockfileTools()["a.tool"]).toBeDefined();
  });

  it("errors (3) and leaves the manifest untouched on an unknown tool", async () => {
    writeManifestFile([{ name: "src", url: fixture.url }]);
    fixture.setTools([{ name: "a.tool" }]);

    const code = await run([...globals(), "add", "a.toolx"], io());

    expect(code).toBe(3);
    expect(loadManifest(manifestPath()).tools).toEqual([]);
    expect(existsSync(lockfilePath())).toBe(false);
  });

  it("accepts --source and --no-generate", async () => {
    writeManifestFile([
      { name: "one", url: fixture.url },
      { name: "two", url: "https://unused.example" },
    ]);
    fixture.setTools([{ name: "a.tool" }]);

    const code = await run(
      [...globals(), "add", "a.tool", "--source", "one", "--no-generate"],
      io(),
    );

    expect(code).toBe(0);
    expect(loadManifest(manifestPath()).tools[0]?.source).toBe("one");
  });

  it("requires --source when there is more than one source (64)", async () => {
    writeManifestFile([
      { name: "one", url: fixture.url },
      { name: "two", url: "https://unused.example" },
    ]);
    const code = await run([...globals(), "add", "a.tool"], io());
    expect(code).toBe(64);
  });

  it("rejects an unknown --source (64)", async () => {
    writeManifestFile([{ name: "src", url: fixture.url }]);
    const code = await run(
      [...globals(), "add", "a.tool", "--source", "ghost"],
      io(),
    );
    expect(code).toBe(64);
  });

  it("errors (64) when the manifest has no sources", async () => {
    writeManifestFile([]);
    expect(await run([...globals(), "add", "a.tool"], io())).toBe(64);
  });
});

describe("remove", () => {
  it("drops a tool from the manifest and lockfile", async () => {
    writeManifestFile([{ name: "src", url: fixture.url }]);
    fixture.setTools([{ name: "a.tool" }, { name: "b.tool" }]);
    await run([...globals(), "add", "a.tool"], io());
    await run([...globals(), "add", "b.tool"], io());

    const code = await run([...globals(), "remove", "a.tool"], io());

    expect(code).toBe(0);
    expect(loadManifest(manifestPath()).tools.map((t) => t.name)).toEqual([
      "b.tool",
    ]);
    expect(readLockfileTools()["a.tool"]).toBeUndefined();
    expect(readLockfileTools()["b.tool"]).toBeDefined();
  });

  it("errors (64) on an undeclared tool", async () => {
    writeManifestFile([{ name: "src", url: fixture.url }]);
    expect(await run([...globals(), "remove", "ghost"], io())).toBe(64);
  });

  it("succeeds when no lockfile exists yet", async () => {
    writeManifestFile(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    expect(await run([...globals(), "remove", "a.tool"], io())).toBe(0);
    expect(loadManifest(manifestPath()).tools).toEqual([]);
  });
});
