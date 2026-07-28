import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import {
  McpFixtureServer,
  type FixtureTool,
} from "../../../test/mcp/fixture-server";
import type { Clock } from "../../core/clock";
import { parseDriftReport } from "../../report/drift-report";
import { run, type CliIo } from "../run";

const clock: Clock = () => 1_700_000_000_000;

let dir: string;
let fixture: McpFixtureServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcplock-vr-"));
  fixture = await McpFixtureServer.start();
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

const manifestPath = () => join(dir, "mcp-tools.yaml");
const lockfilePath = () => join(dir, "mcp-tools.lock");
const globals = () => [
  "--manifest",
  manifestPath(),
  "--lockfile",
  lockfilePath(),
];

const PINNED: FixtureTool = {
  name: "a.tool",
  description: "one",
  inputSchema: { type: "object" },
};
const DRIFTED: FixtureTool = {
  name: "a.tool",
  description: "one",
  inputSchema: { type: "object", required: ["x"] },
};

async function pin(): Promise<void> {
  writeFileSync(
    manifestPath(),
    stringifyYaml({
      version: 1,
      sources: [{ name: "src", url: fixture.url }],
      tools: [{ name: "a.tool", source: "src" }],
    }),
    "utf8",
  );
  fixture.setTools([PINNED]);
  await run([...globals(), "resolve"], io());
}

describe("verify --json", () => {
  it("prints a schema-valid drift report on stdout", async () => {
    await pin();
    fixture.setTools([DRIFTED]);
    const sink = io();
    await run([...globals(), "verify", "--json"], sink);
    const document = JSON.parse(sink.stdout.join("")) as unknown;
    expect(() => parseDriftReport(document)).not.toThrow();
    const parsed = parseDriftReport(document);
    expect(parsed.summary.structural).toBe(1);
    expect(parsed.items[0]?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("verify --report-json", () => {
  it("writes the report even on a non-zero (structural) exit", async () => {
    await pin();
    fixture.setTools([DRIFTED]);
    const out = join(dir, "drift.json");

    const code = await run(
      [...globals(), "verify", "--report-json", out],
      io(),
    );

    expect(code).toBe(1);
    const parsed = parseDriftReport(JSON.parse(readFileSync(out, "utf8")));
    expect(parsed.summary.structural).toBe(1);
    expect(parsed.items[0]?.tool).toBe("a.tool");
  });

  it("produces stable fingerprints across two runs (dedup contract)", async () => {
    await pin();
    fixture.setTools([DRIFTED]);
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");

    await run([...globals(), "verify", "--report-json", a], io());
    await run([...globals(), "verify", "--report-json", b], io());

    const fpA = parseDriftReport(JSON.parse(readFileSync(a, "utf8"))).items.map(
      (i) => i.fingerprint,
    );
    const fpB = parseDriftReport(JSON.parse(readFileSync(b, "utf8"))).items.map(
      (i) => i.fingerprint,
    );
    expect(fpB).toEqual(fpA);
  });
});

describe("verify --report", () => {
  it("writes a markdown report", async () => {
    await pin();
    fixture.setTools([DRIFTED]);
    const out = join(dir, "drift.md");

    await run([...globals(), "verify", "--report", out], io());

    const markdown = readFileSync(out, "utf8");
    expect(markdown).toContain("# Drift report");
    expect(markdown).toContain("a.tool");
  });
});
