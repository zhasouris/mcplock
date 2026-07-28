import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";

import { AuthError } from "../auth/provider";
import { McpError } from "../mcp/client";
import { ResolveError } from "../resolve/engine";
import { LockfileError } from "../schema/lockfile";
import { ManifestError } from "../schema/manifest";
import { DriftReportError } from "../report/drift-report";
import { EXIT, ExitError, exitCodeFor, UsageError } from "./errors";

describe("exitCodeFor (COMMAND_SPEC §3 table)", () => {
  it("ExitError carries its own code", () => {
    expect(exitCodeFor(new ExitError(EXIT.STRUCTURAL, "structural"))).toBe(1);
    expect(exitCodeFor(new ExitError(EXIT.SEMANTIC, "semantic"))).toBe(2);
  });

  it("UsageError maps to 64", () => {
    expect(exitCodeFor(new UsageError("bad flag"))).toBe(64);
  });

  it("commander usage errors map to 64, help/version to 0", () => {
    expect(
      exitCodeFor(new CommanderError(1, "commander.unknownCommand", "unknown")),
    ).toBe(64);
    expect(
      exitCodeFor(new CommanderError(0, "commander.helpDisplayed", "help")),
    ).toBe(0);
  });

  it.each([
    new ManifestError("m"),
    new LockfileError("l"),
    new AuthError("a"),
    new McpError("mcp"),
    new ResolveError("r"),
    new DriftReportError("d"),
  ])("resolution errors map to 3: %s", (error) => {
    expect(exitCodeFor(error)).toBe(3);
  });

  it("unexpected errors map to 70 (internal)", () => {
    expect(exitCodeFor(new Error("boom"))).toBe(70);
    expect(exitCodeFor("a string")).toBe(70);
  });
});
