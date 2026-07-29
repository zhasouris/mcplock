/**
 * Rigorous live drift test against a REAL third-party MCP server (NOT the gate).
 *
 * Spawns two published versions of the official reference server
 * `@modelcontextprotocol/server-everything` over its native streamable-HTTP
 * transport, pins the older version with mcplock, then verifies against the
 * newer one. Real protocol handshake, real transport (a server we did not
 * write), real version-to-version schema drift flowing through mcplock's
 * canonicalization / dual hashing / drift classification.
 *
 * Runs only when MCPLOCK_LIVE=1 (set by scripts/live-smoke.ps1); otherwise the
 * whole suite is skipped and this file is inert during `pnpm test`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { systemClock } from "../../src/core/clock";
import { run, type CliIo } from "../../src/cli/run";
import { McpClient } from "../../src/mcp/client";
import { parseDriftReport } from "../../src/report/drift-report";
import { EVERYTHING, URL, startServer, stopServer } from "./server-harness";

const LIVE = process.env.MCPLOCK_LIVE === "1";
// Real drift: 2025.7.1 (camelCase, 8 tools) -> 2026.7.4 (kebab, 13 tools).
// echo keeps its name but its schema changed (structural); the other 2025.7.1
// tools were renamed away (missing); the new kebab tools are undeclared.
const V_OLD = process.env.MCPLOCK_LIVE_OLD ?? "2025.7.1";
const V_NEW = process.env.MCPLOCK_LIVE_NEW ?? "2026.7.4";

describe.skipIf(!LIVE)("live: real version drift (server-everything)", () => {
  let dir: string;

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

  const manifestPath = (): string => join(dir, "mcp-tools.yaml");
  const lockfilePath = (): string => join(dir, "mcp-tools.lock");
  const paths = (): string[] => [
    "--manifest",
    manifestPath(),
    "--lockfile",
    lockfilePath(),
  ];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mcplock-live-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(`pins ${V_OLD} then detects real drift against ${V_NEW}`, async () => {
    // --- Pin against the OLD version -----------------------------------
    const older = await startServer(`${EVERYTHING}@${V_OLD}`);
    let names: string[];
    try {
      // List via our client — validates the client against a real server.
      const listed = await new McpClient({ url: URL }).listTools();
      names = listed.tools.map((t) => t.name);
      expect(names.length).toBeGreaterThan(5);

      writeFileSync(
        manifestPath(),
        stringifyYaml({
          version: 1,
          sources: [{ name: "everything", url: URL }],
          tools: names.map((name) => ({ name, source: "everything" })),
        }),
        "utf8",
      );
      expect(await run([...paths(), "resolve"], io())).toBe(0);
    } finally {
      await stopServer(older);
    }

    // --- Verify against the NEW version --------------------------------
    const newer = await startServer(`${EVERYTHING}@${V_NEW}`);
    try {
      const reportPath = join(dir, "drift.json");
      const code = await run(
        [...paths(), "verify", "--report-json", reportPath],
        io(),
      );

      const report = parseDriftReport(
        JSON.parse(readFileSync(reportPath, "utf8")),
      );
      process.stderr.write(
        `[live] ${V_OLD} -> ${V_NEW}: exit=${String(code)} ${JSON.stringify(report.summary)}\n`,
      );
      // Real breaking drift between these versions -> exit 1.
      expect(code).toBe(1);
      // echo kept its name but its schema changed -> structural.
      expect(report.items.find((i) => i.tool === "echo")?.class).toBe(
        "structural",
      );
      // Renamed-away tools are missing; new tools are undeclared.
      expect(report.summary.structural).toBeGreaterThanOrEqual(1);
      expect(report.summary.missing).toBeGreaterThanOrEqual(1);
      expect(report.summary.undeclared).toBeGreaterThanOrEqual(1);
      // Every drift item carries a well-formed fingerprint.
      expect(
        report.items.every((i) => /^[0-9a-f]{16}$/.test(i.fingerprint)),
      ).toBe(true);

      // Fingerprints are stable across a second identical run (dedup contract).
      const reportPath2 = join(dir, "drift2.json");
      await run([...paths(), "verify", "--report-json", reportPath2], io());
      const fps1 = report.items.map((i) => i.fingerprint).sort();
      const fps2 = parseDriftReport(
        JSON.parse(readFileSync(reportPath2, "utf8")),
      )
        .items.map((i) => i.fingerprint)
        .sort();
      expect(fps2).toEqual(fps1);
    } finally {
      await stopServer(newer);
    }
  }, 360_000);
});
