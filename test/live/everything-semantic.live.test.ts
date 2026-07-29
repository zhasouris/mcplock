/**
 * Rigorous live SEMANTIC drift test against real server-everything versions.
 *
 * `echo` kept its name AND its input schema between 2025.8.18 and 2026.1.14, but
 * its description was reworded. Pinning ONLY echo isolates that change (no
 * missing/structural), so mcplock classifies it semantic and the --semantic
 * exit-code behaviour (warn=0, fail=2, ignore=0) is exercised on real data.
 *
 * Runs only when MCPLOCK_LIVE=1.
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
const V_OLD = "2025.8.18";
const V_NEW = "2026.1.14";
const TOOL = "echo";

describe.skipIf(!LIVE)("live: real semantic drift (echo reworded)", () => {
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

  const paths = (): string[] => [
    "--manifest",
    join(dir, "mcp-tools.yaml"),
    "--lockfile",
    join(dir, "mcp-tools.lock"),
  ];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mcplock-sem-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(`classifies ${TOOL}'s reworded description as semantic`, async () => {
    // Pin only echo from the OLD version.
    const older = await startServer(`${EVERYTHING}@${V_OLD}`);
    try {
      const names = (await new McpClient({ url: URL }).listTools()).tools.map(
        (t) => t.name,
      );
      expect(names).toContain(TOOL);
      writeFileSync(
        join(dir, "mcp-tools.yaml"),
        stringifyYaml({
          version: 1,
          sources: [{ name: "everything", url: URL }],
          tools: [{ name: TOOL, source: "everything" }],
        }),
        "utf8",
      );
      expect(await run([...paths(), "resolve"], io())).toBe(0);
    } finally {
      await stopServer(older);
    }

    // Verify against the NEW version.
    const newer = await startServer(`${EVERYTHING}@${V_NEW}`);
    try {
      const reportPath = join(dir, "drift.json");
      const warnCode = await run(
        [...paths(), "verify", "--report-json", reportPath],
        io(),
      );
      const report = parseDriftReport(
        JSON.parse(readFileSync(reportPath, "utf8")),
      );
      process.stderr.write(
        `[live semantic] ${V_OLD} -> ${V_NEW}: warn exit=${String(warnCode)} ${JSON.stringify(report.summary)}\n`,
      );

      // echo: description changed, schema unchanged -> semantic.
      expect(report.items.find((i) => i.tool === TOOL)?.class).toBe("semantic");
      expect(report.summary.semantic).toBeGreaterThanOrEqual(1);
      expect(report.summary.structural).toBe(0);
      expect(report.summary.missing).toBe(0);

      // Exit-code behaviour on real semantic drift.
      expect(warnCode).toBe(0); // --semantic warn (default) -> 0
      expect(
        await run([...paths(), "verify", "--semantic", "fail"], io()),
      ).toBe(2);
      expect(
        await run([...paths(), "verify", "--semantic", "ignore"], io()),
      ).toBe(0);
    } finally {
      await stopServer(newer);
    }
  }, 300_000);
});
