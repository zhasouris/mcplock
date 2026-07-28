import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  dir = mkdtempSync(join(tmpdir(), "mcplock-rl-"));
  fixture = await McpFixtureServer.start({ serverVersion: "1.0.0" });
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
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    env: {},
    cwd: dir,
    clock,
  };
}

const manifestPath = () => join(dir, "mcp-tools.yaml");
const lockfilePath = () => join(dir, "mcp-tools.lock");
const globals = () => [
  "--manifest",
  manifestPath(),
  "--lockfile",
  lockfilePath(),
];

function writeManifest(
  sources: { name: string; url: string }[],
  tools: { name: string; source: string }[],
): void {
  writeFileSync(
    manifestPath(),
    stringifyYaml({ version: 1, sources, tools }),
    "utf8",
  );
}

function lockfileBytes(): string {
  return readFileSync(lockfilePath(), "utf8");
}

describe("resolve", () => {
  it("writes a lockfile with byte-identical output on repeat", async () => {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [
        { name: "a.tool", source: "src" },
        { name: "b.tool", source: "src" },
      ],
    );
    fixture.setTools([{ name: "a.tool" }, { name: "b.tool" }]);

    expect(await run([...globals(), "resolve"], io())).toBe(0);
    const first = lockfileBytes();
    expect(await run([...globals(), "resolve"], io())).toBe(0);
    expect(lockfileBytes()).toBe(first);
  });

  it("warns on undeclared tools and still exits 0", async () => {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    fixture.setTools([{ name: "a.tool" }, { name: "extra.tool" }]);

    const sink = io();
    expect(await run([...globals(), "resolve"], sink)).toBe(0);
    expect(sink.stderr.join("")).toContain("extra.tool");
  });

  it("--json prints the resolved tools and warnings", async () => {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    fixture.setTools([{ name: "a.tool" }]);

    const sink = io();
    await run([...globals(), "resolve", "--json"], sink);
    const report = JSON.parse(sink.stdout.join("")) as {
      tools: string[];
      warnings: string[];
    };
    expect(report.tools).toEqual(["a.tool"]);
  });

  it("--source re-resolves one source and preserves the others", async () => {
    writeManifest(
      [
        { name: "one", url: fixture.url },
        { name: "two", url: fixture.url },
      ],
      [
        { name: "a.tool", source: "one" },
        { name: "b.tool", source: "two" },
      ],
    );
    fixture.setTools([{ name: "a.tool" }, { name: "b.tool" }]);

    await run([...globals(), "resolve", "--source", "one"], io());
    await run([...globals(), "resolve", "--source", "two"], io());

    const tools = Object.keys(
      JSON.parse(lockfileBytes()).tools as Record<string, unknown>,
    );
    expect(tools.sort()).toEqual(["a.tool", "b.tool"]);
  });

  it("rejects an unknown --source (64)", async () => {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    expect(
      await run([...globals(), "resolve", "--source", "ghost"], io()),
    ).toBe(64);
  });
});

describe("resolve --frozen", () => {
  async function pin(): Promise<void> {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    fixture.setTools([{ name: "a.tool", inputSchema: { type: "object" } }]);
    await run([...globals(), "resolve"], io());
  }

  it("exits 0 and writes nothing when up to date", async () => {
    await pin();
    const before = lockfileBytes();
    expect(await run([...globals(), "resolve", "--frozen"], io())).toBe(0);
    expect(lockfileBytes()).toBe(before);
  });

  it("exits 1 and writes nothing when resolution would change", async () => {
    await pin();
    const before = lockfileBytes();
    fixture.setTools([
      { name: "a.tool", inputSchema: { type: "object", required: ["x"] } },
    ]);
    expect(await run([...globals(), "resolve", "--frozen"], io())).toBe(1);
    expect(lockfileBytes()).toBe(before);
  });

  it("exits 1 when there is no lockfile", async () => {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    fixture.setTools([{ name: "a.tool" }]);
    expect(await run([...globals(), "resolve", "--frozen"], io())).toBe(1);
  });
});

describe("list", () => {
  async function resolved(): Promise<void> {
    writeManifest(
      [{ name: "src", url: fixture.url }],
      [{ name: "a.tool", source: "src" }],
    );
    fixture.setTools([{ name: "a.tool" }]);
    await run([...globals(), "resolve"], io());
  }

  it("--offline lists pinned tools", async () => {
    await resolved();
    const sink = io();
    expect(await run([...globals(), "list", "--offline"], sink)).toBe(0);
    expect(sink.stdout.join("\n")).toContain("a.tool");
  });

  it("--offline --json emits machine-readable rows", async () => {
    await resolved();
    const sink = io();
    await run([...globals(), "list", "--offline", "--json"], sink);
    const rows = JSON.parse(sink.stdout.join("")) as { tool: string }[];
    expect(rows[0]?.tool).toBe("a.tool");
  });

  it("errors (3) when no lockfile exists", async () => {
    writeManifest([{ name: "src", url: fixture.url }], []);
    expect(await run([...globals(), "list", "--offline"], io())).toBe(3);
  });

  it("shows live drift status when the surface moved", async () => {
    await resolved();
    // Mutate the live schema of a.tool -> structural drift.
    fixture.setTools([
      { name: "a.tool", inputSchema: { type: "object", required: ["x"] } },
    ]);

    const sink = io();
    expect(await run([...globals(), "list", "--json"], sink)).toBe(0);
    const statuses = JSON.parse(sink.stdout.join("")) as {
      tool: string;
      status: string;
    }[];
    expect(statuses).toContainEqual({ tool: "a.tool", status: "structural" });
  });

  it("prints live drift status in human form", async () => {
    await resolved();
    fixture.setTools([
      { name: "a.tool", inputSchema: { type: "object", required: ["x"] } },
    ]);

    const sink = io();
    expect(await run([...globals(), "list"], sink)).toBe(0);
    expect(sink.stdout.join("\n")).toContain("a.tool  structural");
  });
});
