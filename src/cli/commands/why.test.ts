import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { McpFixtureServer } from "../../../test/mcp/fixture-server";
import type { Clock } from "../../core/clock";
import { run, type CliIo } from "../run";

const clock: Clock = () => 1_700_000_000_000;

let dir: string;
let fixture: McpFixtureServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcplock-why-"));
  fixture = await McpFixtureServer.start({ serverVersion: "2.1.0" });
});

afterEach(async () => {
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
});

function io(): CliIo & { stdout: string[] } {
  const stdout: string[] = [];
  return {
    stdout,
    out: (t) => stdout.push(t),
    err: () => undefined,
    env: {},
    cwd: dir,
    clock,
  };
}

const paths = () => [
  "--manifest",
  join(dir, "mcp-tools.yaml"),
  "--lockfile",
  join(dir, "mcp-tools.lock"),
];

async function pin(): Promise<void> {
  writeFileSync(
    join(dir, "mcp-tools.yaml"),
    stringifyYaml({
      version: 1,
      sources: [{ name: "src", url: fixture.url }],
      tools: [{ name: "a.tool", source: "src" }],
    }),
    "utf8",
  );
  fixture.setTools([{ name: "a.tool" }]);
  await run([...paths(), "resolve"], io());
}

describe("why", () => {
  it("explains a pinned tool", async () => {
    await pin();
    const sink = io();
    expect(await run([...paths(), "why", "a.tool"], sink)).toBe(0);
    const output = sink.stdout.join("\n");
    expect(output).toContain("source:        src");
    expect(output).toContain("@ 2.1.0");
    expect(output).toContain("schemaHash:    sha256:");
    expect(output).toContain("resolvedAt:");
  });

  it("--json emits the lockfile entry", async () => {
    await pin();
    const sink = io();
    await run([...paths(), "why", "a.tool", "--json"], sink);
    const entry = JSON.parse(sink.stdout.join("")) as {
      tool: string;
      source: string;
      schemaHash: string;
    };
    expect(entry.tool).toBe("a.tool");
    expect(entry.source).toBe("src");
    expect(entry.schemaHash).toMatch(/^sha256:/);
  });

  it("errors (64) on an unpinned tool", async () => {
    await pin();
    expect(await run([...paths(), "why", "ghost"], io())).toBe(64);
  });

  it("errors (3) when there is no lockfile", async () => {
    writeFileSync(
      join(dir, "mcp-tools.yaml"),
      stringifyYaml({ version: 1, sources: [], tools: [] }),
      "utf8",
    );
    expect(await run([...paths(), "why", "a.tool"], io())).toBe(3);
  });
});
