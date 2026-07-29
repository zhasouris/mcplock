import { describe, expect, it } from "vitest";

import { main, processIo, type ProcessLike } from "./cli";
import { systemClock } from "./core/clock";
import { VERSION } from "./version";

/** A fake process that captures stdout/stderr, argv after the node+script pair. */
function fakeProc(
  args: string[],
): ProcessLike & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    argv: ["node", "mcplock", ...args],
    env: {},
    cwd: () => "/repo",
    stdout: {
      write: (text) => {
        out.push(text);
        return true;
      },
    },
    stderr: {
      write: (text) => {
        err.push(text);
        return true;
      },
    },
    out,
    err,
  };
}

describe("cli entry", () => {
  it("processIo maps stdout/stderr/env/cwd and the injected clock", () => {
    const proc = fakeProc([]);
    const io = processIo(proc);
    io.out("hello");
    io.err("nope");
    expect(proc.out).toEqual(["hello"]);
    expect(proc.err).toEqual(["nope"]);
    expect(io.cwd).toBe("/repo");
    expect(io.clock).toBe(systemClock);
  });

  it("--version prints the version and exits 0", async () => {
    const proc = fakeProc(["--version"]);
    const code = await main(proc);
    expect(code).toBe(0);
    expect(proc.out.join("")).toContain(VERSION);
  });

  it("--help exits 0 and names the program", async () => {
    const proc = fakeProc(["--help"]);
    const code = await main(proc);
    expect(code).toBe(0);
    expect(proc.out.join("")).toContain("mcplock");
  });

  it("an unknown command exits non-zero", async () => {
    const proc = fakeProc(["definitely-not-a-command"]);
    const code = await main(proc);
    expect(code).not.toBe(0);
  });
});
