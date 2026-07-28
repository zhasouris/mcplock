import { beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../core/clock";
import type { ExecConfig } from "./config";
import {
  AuthError,
  createAuthProvider,
  ExecProvider,
  type ExecRunner,
} from "./provider";

const REPO = "/repo";
const clockRef = { now: 1000 };
const clock: Clock = () => clockRef.now;

beforeEach(() => {
  clockRef.now = 1000;
});

function config(overrides: Partial<ExecConfig> = {}): ExecConfig {
  return { type: "exec", command: "scripts/get-token.sh", ...overrides };
}

function runnerReturning(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const runner: ExecRunner = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return Promise.resolve({ stdout, exitCode });
  };
  return { runner, calls };
}

function ctx(): {
  sourceName: string;
  env: Record<string, string | undefined>;
} {
  return { sourceName: "contracts-api", env: {} };
}

describe("success", () => {
  it("resolves the repo-relative command and returns a Bearer header", async () => {
    const { runner, calls } = runnerReturning(
      JSON.stringify({ token: "t-1", expiresAt: "2999-01-01T00:00:00Z" }),
    );
    const provider = new ExecProvider(
      config({ args: ["--json"] }),
      clock,
      REPO,
      runner,
    );

    const headers = await provider.headers(ctx());

    expect(headers).toEqual({ Authorization: "Bearer t-1" });
    expect(calls[0]).toEqual({
      command: "/repo/scripts/get-token.sh",
      args: ["--json"],
      cwd: "/repo",
    });
  });
});

describe("path constraint (defense in depth beyond the schema)", () => {
  it("rejects an absolute command", async () => {
    const { runner } = runnerReturning("{}");
    const provider = new ExecProvider(
      config({ command: "/etc/get-token" }),
      clock,
      REPO,
      runner,
    );
    await expect(provider.headers(ctx())).rejects.toThrow(/repo-relative/);
  });

  it("rejects a command that escapes the repo", async () => {
    const { runner } = runnerReturning("{}");
    const provider = new ExecProvider(
      config({ command: "../evil.sh" }),
      clock,
      REPO,
      runner,
    );
    await expect(provider.headers(ctx())).rejects.toThrow(/escapes the repo/);
  });
});

describe("output and exit handling", () => {
  it("rejects a non-zero exit", async () => {
    const { runner } = runnerReturning("", 3);
    await expect(
      new ExecProvider(config(), clock, REPO, runner).headers(ctx()),
    ).rejects.toThrow(/exited with code 3/);
  });

  it("rejects malformed JSON", async () => {
    const { runner } = runnerReturning("not json");
    await expect(
      new ExecProvider(config(), clock, REPO, runner).headers(ctx()),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("rejects non-object output", async () => {
    const { runner } = runnerReturning(JSON.stringify("a string"));
    await expect(
      new ExecProvider(config(), clock, REPO, runner).headers(ctx()),
    ).rejects.toThrow(/not an object/);
  });

  it("rejects output with no token", async () => {
    const { runner } = runnerReturning(JSON.stringify({ expiresAt: "x" }));
    await expect(
      new ExecProvider(config(), clock, REPO, runner).headers(ctx()),
    ).rejects.toThrow(/no token/);
  });

  it("wraps a runner failure", async () => {
    const runner: ExecRunner = () => Promise.reject(new Error("ENOENT"));
    await expect(
      new ExecProvider(config(), clock, REPO, runner).headers(ctx()),
    ).rejects.toThrow(AuthError);
  });
});

describe("caching", () => {
  it("caches a token with a future expiresAt", async () => {
    const { runner, calls } = runnerReturning(
      JSON.stringify({ token: "t", expiresAt: "2999-01-01T00:00:00Z" }),
    );
    const provider = new ExecProvider(config(), clock, REPO, runner);
    await provider.headers(ctx());
    clockRef.now = 5000;
    await provider.headers(ctx());
    expect(calls).toHaveLength(1);
  });

  it("never caches when expiresAt is absent", async () => {
    const { runner, calls } = runnerReturning(JSON.stringify({ token: "t" }));
    const provider = new ExecProvider(config(), clock, REPO, runner);
    await provider.headers(ctx());
    await provider.headers(ctx());
    expect(calls).toHaveLength(2);
  });

  it("treats an unparseable expiresAt as no-cache", async () => {
    const { runner, calls } = runnerReturning(
      JSON.stringify({ token: "t", expiresAt: "not-a-date" }),
    );
    const provider = new ExecProvider(config(), clock, REPO, runner);
    await provider.headers(ctx());
    await provider.headers(ctx());
    expect(calls).toHaveLength(2);
  });

  it("refetches once the token nears expiry", async () => {
    // expiresAt = 60_000ms; skew 30s => valid until 30_000ms.
    const { runner, calls } = runnerReturning(
      JSON.stringify({ token: "t", expiresAt: "1970-01-01T00:01:00Z" }),
    );
    const provider = new ExecProvider(config(), clock, REPO, runner);
    await provider.headers(ctx());
    clockRef.now = 40_000;
    await provider.headers(ctx());
    expect(calls).toHaveLength(2);
  });
});

describe("createAuthProvider", () => {
  it("builds an exec provider with the injected runner and repo root", async () => {
    const { runner, calls } = runnerReturning(JSON.stringify({ token: "t" }));
    const provider = createAuthProvider(config(), {
      clock,
      repoRoot: REPO,
      execRunner: runner,
    });
    expect(provider.type).toBe("exec");
    await provider.headers(ctx());
    expect(calls[0]?.cwd).toBe("/repo");
  });
});
