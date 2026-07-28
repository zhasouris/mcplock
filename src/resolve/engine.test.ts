import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpFixtureServer } from "../../test/mcp/fixture-server";
import { msToIso } from "../core/clock";
import { hashTool } from "../core/hash";
import { parseManifest, type Manifest } from "../schema/manifest";
import { serializeLockfile } from "../schema/lockfile";
import { resolve, ResolveError, resolveSourceHeaders } from "./engine";

const NOW = 1_700_000_000_000;
const clock = () => NOW;

let fixture: McpFixtureServer;

beforeEach(async () => {
  fixture = await McpFixtureServer.start({ serverVersion: "2.0.0" });
});

afterEach(async () => {
  await fixture.close();
});

function manifestFor(
  url: string,
  toolNames: string[],
  source: Record<string, unknown> = {},
): Manifest {
  return parseManifest({
    version: 1,
    sources: [{ name: "src", url, ...source }],
    tools: toolNames.map((name) => ({ name, source: "src" })),
  });
}

function run(manifest: Manifest, env: Record<string, string | undefined> = {}) {
  return resolve({
    manifest,
    env,
    clock,
    cwd: "/repo",
    generatedBy: "mcplock@0.1.0",
  });
}

describe("resolution", () => {
  it("pins declared tools with dual hashes, source, version, and resolvedAt", async () => {
    fixture.setTools([
      { name: "a.tool", description: "A", inputSchema: { type: "object" } },
      { name: "b.tool" },
    ]);

    const { lockfile, warnings } = await run(
      manifestFor(fixture.url, ["a.tool", "b.tool"]),
    );

    expect(warnings).toEqual([]);
    expect(lockfile.generatedBy).toBe("mcplock@0.1.0");
    const a = lockfile.tools["a.tool"];
    expect(a?.source).toBe("src");
    expect(a?.resolvedServer).toBe(fixture.url);
    expect(a?.serverVersion).toBe("2.0.0");
    expect(a?.resolvedAt).toBe(msToIso(NOW));

    const expected = hashTool({
      name: "a.tool",
      description: "A",
      inputSchema: { type: "object" },
    });
    expect(a?.schemaHash).toBe(expected.schemaHash);
    expect(a?.semanticHash).toBe(expected.semanticHash);
  });

  it("warns on undeclared live tools but still resolves", async () => {
    fixture.setTools([{ name: "a.tool" }, { name: "extra.tool" }]);

    const { lockfile, warnings } = await run(
      manifestFor(fixture.url, ["a.tool"]),
    );

    expect(lockfile.tools["a.tool"]).toBeDefined();
    expect(lockfile.tools["extra.tool"]).toBeUndefined();
    expect(warnings).toEqual([
      'source "src" offers undeclared tool "extra.tool"',
    ]);
  });

  it("produces byte-identical lockfiles across runs", async () => {
    fixture.setTools([{ name: "a.tool" }, { name: "b.tool" }]);
    const manifest = manifestFor(fixture.url, ["a.tool", "b.tool"]);

    const first = await run(manifest);
    const second = await run(manifest);

    expect(serializeLockfile(second.lockfile)).toBe(
      serializeLockfile(first.lockfile),
    );
  });

  it("resolves tools across multiple sources", async () => {
    const other = await McpFixtureServer.start();
    try {
      fixture.setTools([{ name: "a.tool" }]);
      other.setTools([{ name: "z.tool" }]);
      const manifest = parseManifest({
        version: 1,
        sources: [
          { name: "one", url: fixture.url },
          { name: "two", url: other.url },
        ],
        tools: [
          { name: "a.tool", source: "one" },
          { name: "z.tool", source: "two" },
        ],
      });

      const { lockfile } = await run(manifest);

      expect(lockfile.tools["a.tool"]?.source).toBe("one");
      expect(lockfile.tools["z.tool"]?.source).toBe("two");
    } finally {
      await other.close();
    }
  });
});

describe("missing tools", () => {
  it("errors with a near-miss suggestion", async () => {
    fixture.setTools([{ name: "list_expiring" }]);
    await expect(
      run(manifestFor(fixture.url, ["list_expirng"])),
    ).rejects.toThrow(/did you mean "list_expiring"/);
  });

  it("errors without a suggestion when nothing is close", async () => {
    fixture.setTools([{ name: "totally_different" }]);
    const error = await run(manifestFor(fixture.url, ["list_expiring"])).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ResolveError);
    expect((error as ResolveError).message).toContain(
      'not found on source "src"',
    );
    expect((error as ResolveError).message).not.toContain("did you mean");
  });

  it("orders equidistant suggestions by name", async () => {
    fixture.setTools([{ name: "ba" }, { name: "ab" }]);
    const error = await run(manifestFor(fixture.url, ["aa"])).catch(
      (e: unknown) => e,
    );
    expect((error as ResolveError).message).toContain(
      'did you mean "ab", "ba"?',
    );
  });
});

describe("auth composition", () => {
  it("resolves a bearer-env source when the token is present", async () => {
    fixture.setTools([{ name: "a.tool" }]);
    const manifest = manifestFor(fixture.url, ["a.tool"], {
      auth: "bearer-env",
    });
    await expect(
      run(manifest, { MCPLOCK_TOKEN_SRC: "tok" }),
    ).resolves.toBeDefined();
  });

  it("surfaces an auth error when the token is missing", async () => {
    fixture.setTools([{ name: "a.tool" }]);
    const manifest = manifestFor(fixture.url, ["a.tool"], {
      auth: "bearer-env",
    });
    await expect(run(manifest, {})).rejects.toThrow(/MCPLOCK_TOKEN_SRC/);
  });
});

describe("resolveSourceHeaders", () => {
  it("interpolates ${env:VAR} values", () => {
    expect(
      resolveSourceHeaders({ "X-Api-Key": "${env:KEY}" }, { KEY: "v" }),
    ).toEqual({ "X-Api-Key": "v" });
  });

  it("returns {} for no headers", () => {
    expect(resolveSourceHeaders(undefined, {})).toEqual({});
  });

  it("errors on an unset variable", () => {
    expect(() => resolveSourceHeaders({ X: "${env:MISSING}" }, {})).toThrow(
      /unset environment variable MISSING/,
    );
  });

  it("errors on a non-interpolated value", () => {
    expect(() => resolveSourceHeaders({ X: "literal" }, {})).toThrow(
      /must be a \$\{env:VAR\} interpolation/,
    );
  });
});
