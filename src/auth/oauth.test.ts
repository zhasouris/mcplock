import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockOAuthServer } from "../../test/auth/mock-oauth-server";
import type { Clock } from "../core/clock";
import type { OAuthConfig } from "./config";
import { AuthError, OAuthProvider } from "./provider";

let server: MockOAuthServer;
const clockRef = { now: 1000 };
const clock: Clock = () => clockRef.now;

beforeEach(async () => {
  server = await MockOAuthServer.start();
  clockRef.now = 1000;
  server.setAccessToken("access-abc");
  server.setExpiresIn(3600);
});

afterEach(async () => {
  await server.close();
});

function oauthConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    type: "oauth-client-credentials",
    tokenUrl: server.tokenUrl,
    clientId: "cid",
    ...overrides,
  };
}

describe("client-secret mode", () => {
  it("sends the client secret and returns a Bearer header", async () => {
    const provider = new OAuthProvider(oauthConfig({ scope: "s" }), clock);
    const headers = await provider.headers({
      sourceName: "contracts-api",
      env: { MCPLOCK_CLIENT_SECRET_CONTRACTS_API: "shh" },
    });

    expect(headers).toEqual({ Authorization: "Bearer access-abc" });
    expect(server.lastTokenRequest).toMatchObject({
      grant_type: "client_credentials",
      client_id: "cid",
      client_secret: "shh",
      scope: "s",
    });
  });

  it("errors, naming the env var, when the secret is missing", async () => {
    const provider = new OAuthProvider(oauthConfig(), clock);
    await expect(
      provider.headers({ sourceName: "contracts-api", env: {} }),
    ).rejects.toThrow(/MCPLOCK_CLIENT_SECRET_CONTRACTS_API/);
  });
});

describe("assertion: env mode (RFC 7523)", () => {
  it("sends the env JWT as a client assertion", async () => {
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "env" }),
      clock,
    );
    await provider.headers({
      sourceName: "contracts-api",
      env: { MCPLOCK_OIDC_TOKEN_CONTRACTS_API: "jwt-xyz" },
    });

    expect(server.lastTokenRequest).toMatchObject({
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: "jwt-xyz",
    });
  });

  it("errors when the assertion env var is missing", async () => {
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "env" }),
      clock,
    );
    await expect(
      provider.headers({ sourceName: "contracts-api", env: {} }),
    ).rejects.toThrow(/MCPLOCK_OIDC_TOKEN_CONTRACTS_API/);
  });
});

describe("assertion: oidc mode (ambient GitHub Actions)", () => {
  it("fetches the ambient OIDC token and exchanges it", async () => {
    server.setOidcJwt("gh-jwt-123");
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "oidc", audience: "api://contracts" }),
      clock,
    );

    await provider.headers({
      sourceName: "contracts-api",
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL: server.oidcUrl,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "gh-req-token",
      },
    });

    expect(server.lastOidcRequest?.url).toContain(
      "audience=api%3A%2F%2Fcontracts",
    );
    expect(server.lastOidcRequest?.authorization).toBe("Bearer gh-req-token");
    expect(server.lastTokenRequest?.client_assertion).toBe("gh-jwt-123");
  });

  it("errors when the GitHub OIDC environment is absent", async () => {
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "oidc", audience: "api://x" }),
      clock,
    );
    await expect(
      provider.headers({ sourceName: "contracts-api", env: {} }),
    ).rejects.toThrow(/GitHub Actions OIDC/);
  });

  it("errors when no audience is configured", async () => {
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "oidc" }),
      clock,
    );
    await expect(
      provider.headers({
        sourceName: "contracts-api",
        env: {
          ACTIONS_ID_TOKEN_REQUEST_URL: server.oidcUrl,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "gh-req-token",
        },
      }),
    ).rejects.toThrow(/audience/);
  });

  it("falls back to MCPLOCK_OIDC_AUDIENCE", async () => {
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "oidc" }),
      clock,
    );
    await provider.headers({
      sourceName: "contracts-api",
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL: server.oidcUrl,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "gh-req-token",
        MCPLOCK_OIDC_AUDIENCE: "api://from-env",
      },
    });
    expect(server.lastOidcRequest?.url).toContain(
      "audience=api%3A%2F%2Ffrom-env",
    );
  });

  it("errors when the OIDC endpoint returns a non-2xx", async () => {
    server.setOidcResponse(500, "boom");
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "oidc", audience: "api://x" }),
      clock,
    );
    await expect(
      provider.headers({
        sourceName: "contracts-api",
        env: {
          ACTIONS_ID_TOKEN_REQUEST_URL: server.oidcUrl,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "gh-req-token",
        },
      }),
    ).rejects.toThrow(/OIDC token request failed/);
  });

  it("errors when the OIDC response has no value", async () => {
    server.setOidcResponse(200, JSON.stringify({ nope: true }));
    const provider = new OAuthProvider(
      oauthConfig({ assertion: "oidc", audience: "api://x" }),
      clock,
    );
    await expect(
      provider.headers({
        sourceName: "contracts-api",
        env: {
          ACTIONS_ID_TOKEN_REQUEST_URL: server.oidcUrl,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "gh-req-token",
        },
      }),
    ).rejects.toThrow(/no value/);
  });
});

describe("token caching and expiry", () => {
  const env = { MCPLOCK_CLIENT_SECRET_CONTRACTS_API: "shh" };

  it("caches the token across calls", async () => {
    const provider = new OAuthProvider(oauthConfig(), clock);
    await provider.headers({ sourceName: "contracts-api", env });
    clockRef.now = 2000;
    await provider.headers({ sourceName: "contracts-api", env });
    expect(server.tokenRequestCount).toBe(1);
  });

  it("refetches once the token nears expiry", async () => {
    server.setExpiresIn(60); // expires at 61_000ms; skew 30s => valid until 31_000
    const provider = new OAuthProvider(oauthConfig(), clock);
    await provider.headers({ sourceName: "contracts-api", env });
    clockRef.now = 40_000;
    await provider.headers({ sourceName: "contracts-api", env });
    expect(server.tokenRequestCount).toBe(2);
  });
});

describe("error taxonomy", () => {
  const env = { MCPLOCK_CLIENT_SECRET_CONTRACTS_API: "shh" };

  it("surfaces an OAuth error body", async () => {
    server.setTokenResponse(
      401,
      JSON.stringify({
        error: "invalid_client",
        error_description: "bad secret",
      }),
    );
    const provider = new OAuthProvider(oauthConfig(), clock);
    const error = await provider
      .headers({ sourceName: "contracts-api", env })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).message).toMatch(
      /401.*invalid_client.*bad secret/,
    );
  });

  it("rejects a response with no access_token", async () => {
    server.setTokenResponse(200, JSON.stringify({ token_type: "Bearer" }));
    const provider = new OAuthProvider(oauthConfig(), clock);
    await expect(
      provider.headers({ sourceName: "contracts-api", env }),
    ).rejects.toThrow(/no access_token/);
  });

  it("wraps an unreachable token endpoint", async () => {
    const url = server.tokenUrl;
    await server.close();
    const provider = new OAuthProvider(oauthConfig({ tokenUrl: url }), clock);
    await expect(
      provider.headers({ sourceName: "contracts-api", env }),
    ).rejects.toThrow(/could not reach/);
    server = await MockOAuthServer.start(); // afterEach closes this one
  });
});
