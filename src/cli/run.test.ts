import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { systemClock } from "../core/clock";
import { ManifestError } from "../schema/manifest";
import { ExitError } from "./errors";
import {
  DEFAULT_LOCKFILE,
  DEFAULT_MANIFEST,
  run,
  type CliIo,
  type CommandRegistrar,
} from "./run";

function fakeIo(): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    env: {},
    cwd: "/repo",
    clock: systemClock,
  };
}

/** A registrar that adds a `real` command running `action`. */
function command(action: () => void | Promise<void>): CommandRegistrar {
  return (program: Command) => {
    program.command("real").action(action);
  };
}

describe("built-in behaviour", () => {
  it("--help exits 0 and prints usage", async () => {
    const io = fakeIo();
    const code = await run(["--help"], io);
    expect(code).toBe(0);
    expect(io.stdout.join("")).toContain("mcplock");
  });

  it("--version exits 0 and prints the version", async () => {
    const io = fakeIo();
    const code = await run(["--version"], io);
    expect(code).toBe(0);
    expect(io.stdout.join("")).toContain("0.0.0");
  });
});

describe("exit codes", () => {
  it("a successful command exits 0", async () => {
    expect(await run(["real"], fakeIo(), [command(() => undefined)])).toBe(0);
  });

  it("an unknown command exits 64", async () => {
    expect(await run(["bogus"], fakeIo(), [command(() => undefined)])).toBe(64);
  });

  it("a resolution error exits 3", async () => {
    const code = await run(["real"], fakeIo(), [
      command(() => {
        throw new ManifestError("bad manifest");
      }),
    ]);
    expect(code).toBe(3);
  });

  it("a command's ExitError carries its code", async () => {
    const code = await run(["real"], fakeIo(), [
      command(() => {
        throw new ExitError(1, "structural drift");
      }),
    ]);
    expect(code).toBe(1);
  });

  it("an unexpected error exits 70 and prints the message", async () => {
    const io = fakeIo();
    const code = await run(["real"], io, [
      command(() => {
        throw new Error("kaboom");
      }),
    ]);
    expect(code).toBe(70);
    expect(io.stderr.join("")).toContain("kaboom");
  });

  it("prints a non-Error thrown value", async () => {
    const io = fakeIo();
    const notAnError: unknown = "plain-string-failure";
    const code = await run(["real"], io, [
      command(() => {
        throw notAnError;
      }),
    ]);
    expect(code).toBe(70);
    expect(io.stderr.join("")).toContain("plain-string-failure");
  });
});

describe("global options", () => {
  function optsRegistrar(sink: {
    opts?: Record<string, unknown>;
  }): CommandRegistrar {
    return (program: Command) => {
      program.command("real").action(() => {
        sink.opts = program.opts();
      });
    };
  }

  it("defaults manifest and lockfile paths", async () => {
    const sink: { opts?: Record<string, unknown> } = {};
    await run(["real"], fakeIo(), [optsRegistrar(sink)]);
    expect(sink.opts?.manifest).toBe(DEFAULT_MANIFEST);
    expect(sink.opts?.lockfile).toBe(DEFAULT_LOCKFILE);
  });

  it("accepts global options before the command", async () => {
    const sink: { opts?: Record<string, unknown> } = {};
    await run(["--manifest", "custom.yaml", "--quiet", "real"], fakeIo(), [
      optsRegistrar(sink),
    ]);
    expect(sink.opts?.manifest).toBe("custom.yaml");
    expect(sink.opts?.quiet).toBe(true);
  });
});
