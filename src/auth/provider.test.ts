import { describe, expect, it } from "vitest";

import { AuthError, createAuthProvider, tokenEnvVar } from "./provider";

describe("tokenEnvVar", () => {
  it.each([
    ["contracts-api", "MCPLOCK_TOKEN_CONTRACTS_API"],
    ["billing", "MCPLOCK_TOKEN_BILLING"],
    ["a-b-c", "MCPLOCK_TOKEN_A_B_C"],
    ["s3", "MCPLOCK_TOKEN_S3"],
  ])("maps %s to %s", (source, expected) => {
    expect(tokenEnvVar(source)).toBe(expected);
  });
});

describe("none provider", () => {
  it("adds no headers", async () => {
    const provider = createAuthProvider("none");
    expect(provider.type).toBe("none");
    await expect(
      provider.headers({ sourceName: "any", env: {} }),
    ).resolves.toEqual({});
  });
});

describe("bearer-env provider", () => {
  it("reads MCPLOCK_TOKEN_<SOURCE> into a Bearer header", async () => {
    const provider = createAuthProvider("bearer-env");
    const headers = await provider.headers({
      sourceName: "contracts-api",
      env: { MCPLOCK_TOKEN_CONTRACTS_API: "secret-123" },
    });
    expect(headers).toEqual({ Authorization: "Bearer secret-123" });
  });

  it("errors, naming the source and variable, when the token is missing", async () => {
    const provider = createAuthProvider("bearer-env");
    await expect(
      provider.headers({ sourceName: "contracts-api", env: {} }),
    ).rejects.toThrow(/contracts-api.*MCPLOCK_TOKEN_CONTRACTS_API/);
  });

  it("treats an empty token as missing", async () => {
    const provider = createAuthProvider("bearer-env");
    await expect(
      provider.headers({
        sourceName: "billing",
        env: { MCPLOCK_TOKEN_BILLING: "" },
      }),
    ).rejects.toThrow(AuthError);
  });
});

describe("createAuthProvider", () => {
  it.each(["oauth-client-credentials", "oidc", "exec"])(
    "rejects the not-yet-implemented %s",
    (type) => {
      expect(() => createAuthProvider(type)).toThrow(/not yet implemented/);
    },
  );

  it("rejects an unknown type", () => {
    expect(() => createAuthProvider("kerberos")).toThrow(/unknown auth type/);
  });
});
