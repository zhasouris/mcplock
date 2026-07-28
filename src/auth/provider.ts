/**
 * Auth providers (COMMAND_SPEC §8). mcplock authenticates only to *list* tools,
 * never to invoke them, and credentials never touch the manifest or lockfile.
 *
 * A provider turns a source + environment into the request headers the MCP
 * client attaches:
 *   - `none`       — unauthenticated.
 *   - `bearer-env` — Bearer token from `MCPLOCK_TOKEN_<SOURCE>` (§9).
 *   - `oauth-client-credentials` — RFC 6749, with client-secret or RFC 7523
 *     assertion modes (see {@link OAuthProvider}).
 *   - `exec` — reserved for the next commit.
 *
 * The oauth provider is a token *consumer*, not a broker: a fetched token is
 * only ever used for this source's own `tools/list`, never handed out.
 */
import { spawn } from "node:child_process";
import {
  isAbsolute,
  relative as relativePath,
  resolve as resolvePath,
} from "node:path";

import { parseIsoToMs, systemClock, type Clock } from "../core/clock";
import type { AuthSpec, ExecConfig, OAuthConfig } from "./config";

/** Per-source context for computing auth headers. */
export interface AuthContext {
  sourceName: string;
  env: Record<string, string | undefined>;
}

export interface AuthProvider {
  readonly type: string;
  /** Headers to attach to `tools/list` requests for this source. */
  headers(context: AuthContext): Promise<Record<string, string>>;
}

/** Any authentication failure (maps to exit 3, always names the source). */
export class AuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthError";
  }
}

/** `<SOURCE>` suffix for env vars: uppercased with `-` → `_`. */
function envSuffix(sourceName: string): string {
  return sourceName.toUpperCase().replace(/-/g, "_");
}

/** `MCPLOCK_TOKEN_<SOURCE>` — bearer-env token (COMMAND_SPEC §8/§9). */
export function tokenEnvVar(sourceName: string): string {
  return `MCPLOCK_TOKEN_${envSuffix(sourceName)}`;
}

/** `MCPLOCK_CLIENT_SECRET_<SOURCE>` — oauth client secret. */
function clientSecretEnvVar(sourceName: string): string {
  return `MCPLOCK_CLIENT_SECRET_${envSuffix(sourceName)}`;
}

/** `MCPLOCK_OIDC_TOKEN_<SOURCE>` — oauth assertion:env JWT. */
function oidcTokenEnvVar(sourceName: string): string {
  return `MCPLOCK_OIDC_TOKEN_${envSuffix(sourceName)}`;
}

class NoneAuthProvider implements AuthProvider {
  readonly type = "none";

  headers(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }
}

class BearerEnvAuthProvider implements AuthProvider {
  readonly type = "bearer-env";

  async headers(context: AuthContext): Promise<Record<string, string>> {
    const variable = tokenEnvVar(context.sourceName);
    const token = context.env[variable];
    if (token === undefined || token === "") {
      throw new AuthError(
        `source "${context.sourceName}" uses bearer-env auth but ${variable} is not set`,
      );
    }
    return { Authorization: `Bearer ${token}` };
  }
}

const OAUTH_EXPIRY_SKEW_MS = 30_000;
const DEFAULT_EXPIRES_IN_SEC = 3600;
const JWT_BEARER_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

async function describeOAuthError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as {
      error?: unknown;
      error_description?: unknown;
    };
    if (typeof body.error === "string") {
      const description =
        typeof body.error_description === "string"
          ? `: ${body.error_description}`
          : "";
      return ` — ${body.error}${description}`;
    }
  } catch {
    // Not a JSON OAuth error body.
  }
  return "";
}

export class OAuthProvider implements AuthProvider {
  readonly type = "oauth-client-credentials";
  private cached: CachedToken | undefined;

  constructor(
    private readonly config: OAuthConfig,
    private readonly clock: Clock,
  ) {}

  async headers(context: AuthContext): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.accessToken(context)}` };
  }

  private async accessToken(context: AuthContext): Promise<string> {
    const now = this.clock();
    const cached = this.cached;
    if (
      cached !== undefined &&
      cached.expiresAtMs - OAUTH_EXPIRY_SKEW_MS > now
    ) {
      return cached.accessToken;
    }
    const { accessToken, expiresInSec } = await this.requestToken(context);
    this.cached = { accessToken, expiresAtMs: now + expiresInSec * 1000 };
    return accessToken;
  }

  private async requestToken(
    context: AuthContext,
  ): Promise<{ accessToken: string; expiresInSec: number }> {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
    });
    if (this.config.scope !== undefined) params.set("scope", this.config.scope);
    if (this.config.audience !== undefined) {
      params.set("audience", this.config.audience);
    }
    await this.applyCredential(params, context);

    let res: Response;
    try {
      res = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: params.toString(),
      });
    } catch (cause) {
      throw new AuthError(
        `token request for "${context.sourceName}" could not reach ${this.config.tokenUrl}`,
        { cause },
      );
    }
    if (!res.ok) {
      throw new AuthError(
        `token request for "${context.sourceName}" was rejected (HTTP ${String(res.status)})${await describeOAuthError(res)}`,
      );
    }
    const data = (await res.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (data === null || typeof data.access_token !== "string") {
      throw new AuthError(
        `token response for "${context.sourceName}" had no access_token`,
      );
    }
    const expiresInSec =
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : DEFAULT_EXPIRES_IN_SEC;
    return { accessToken: data.access_token, expiresInSec };
  }

  private async applyCredential(
    params: URLSearchParams,
    context: AuthContext,
  ): Promise<void> {
    if (this.config.assertion === undefined) {
      const variable = clientSecretEnvVar(context.sourceName);
      const secret = context.env[variable];
      if (secret === undefined || secret === "") {
        throw new AuthError(
          `source "${context.sourceName}" oauth (client-secret) requires ${variable}`,
        );
      }
      params.set("client_secret", secret);
      return;
    }
    params.set("client_assertion_type", JWT_BEARER_ASSERTION_TYPE);
    params.set("client_assertion", await this.assertionJwt(context));
  }

  private async assertionJwt(context: AuthContext): Promise<string> {
    if (this.config.assertion === "env") {
      const variable = oidcTokenEnvVar(context.sourceName);
      const jwt = context.env[variable];
      if (jwt === undefined || jwt === "") {
        throw new AuthError(
          `source "${context.sourceName}" oauth (assertion: env) requires ${variable}`,
        );
      }
      return jwt;
    }
    return this.fetchAmbientOidcToken(context);
  }

  private async fetchAmbientOidcToken(context: AuthContext): Promise<string> {
    const requestUrl = context.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = context.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (
      requestUrl === undefined ||
      requestUrl === "" ||
      requestToken === undefined ||
      requestToken === ""
    ) {
      throw new AuthError(
        `source "${context.sourceName}" uses assertion: oidc but the GitHub Actions OIDC environment (ACTIONS_ID_TOKEN_REQUEST_URL/_TOKEN) is absent`,
      );
    }
    const audience = this.config.audience ?? context.env.MCPLOCK_OIDC_AUDIENCE;
    if (audience === undefined || audience === "") {
      throw new AuthError(
        `source "${context.sourceName}" assertion: oidc needs an audience (config.audience or MCPLOCK_OIDC_AUDIENCE)`,
      );
    }
    const separator = requestUrl.includes("?") ? "&" : "?";
    const url = `${requestUrl}${separator}audience=${encodeURIComponent(audience)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          authorization: `Bearer ${requestToken}`,
          accept: "application/json",
        },
      });
    } catch (cause) {
      throw new AuthError(
        `source "${context.sourceName}" could not reach the GitHub Actions OIDC endpoint`,
        { cause },
      );
    }
    if (!res.ok) {
      throw new AuthError(
        `source "${context.sourceName}" OIDC token request failed (HTTP ${String(res.status)})`,
      );
    }
    const data = (await res.json().catch(() => null)) as {
      value?: unknown;
    } | null;
    if (data === null || typeof data.value !== "string") {
      throw new AuthError(
        `source "${context.sourceName}" OIDC token response had no value`,
      );
    }
    return data.value;
  }
}

/** Runs an exec-credential command; injected so tests never spawn processes. */
export type ExecRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; exitCode: number }>;

/* c8 ignore start -- thin child_process wrapper; a repo-relative executable
   cannot be hosted hermetically on the Windows-mounted dev FS (no +x bit), so
   this is exercised via injected-runner tests, not unit coverage. */
const spawnRunner: ExecRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, exitCode: code ?? 0 });
    });
  });
/* c8 ignore stop */

interface ExecCredential {
  token: string;
  expiresAtMs: number;
}

function parseExecCredential(
  stdout: string,
  sourceName: string,
): ExecCredential {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new AuthError(
      `exec auth for "${sourceName}" printed invalid JSON on stdout`,
    );
  }
  if (data === null || typeof data !== "object") {
    throw new AuthError(
      `exec auth for "${sourceName}" output was not an object`,
    );
  }
  const credential = data as { token?: unknown; expiresAt?: unknown };
  if (typeof credential.token !== "string" || credential.token === "") {
    throw new AuthError(`exec auth for "${sourceName}" output had no token`);
  }
  // expiresAt is optional; without it the token is never cached.
  const expiresAtMs =
    typeof credential.expiresAt === "string"
      ? (parseIsoToMs(credential.expiresAt) ?? 0)
      : 0;
  return { token: credential.token, expiresAtMs };
}

/**
 * kubectl-style exec credential (COMMAND_SPEC §8). Runs a repo-relative command
 * that prints `{ token, expiresAt }`; absolute paths, $PATH lookup, and repo
 * escape are rejected.
 */
export class ExecProvider implements AuthProvider {
  readonly type = "exec";
  private cached: CachedToken | undefined;

  constructor(
    private readonly config: ExecConfig,
    private readonly clock: Clock,
    private readonly repoRoot: string,
    private readonly runner: ExecRunner,
  ) {}

  async headers(context: AuthContext): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token(context)}` };
  }

  private async token(context: AuthContext): Promise<string> {
    const now = this.clock();
    const cached = this.cached;
    if (
      cached !== undefined &&
      cached.expiresAtMs - OAUTH_EXPIRY_SKEW_MS > now
    ) {
      return cached.accessToken;
    }
    const command = this.resolveCommand(context.sourceName);
    let result: { stdout: string; exitCode: number };
    try {
      result = await this.runner(command, this.config.args ?? [], {
        cwd: this.repoRoot,
      });
    } catch (cause) {
      throw new AuthError(
        `exec auth for "${context.sourceName}" could not run ${this.config.command}`,
        { cause },
      );
    }
    if (result.exitCode !== 0) {
      throw new AuthError(
        `exec auth for "${context.sourceName}" exited with code ${String(result.exitCode)}`,
      );
    }
    const credential = parseExecCredential(result.stdout, context.sourceName);
    this.cached = {
      accessToken: credential.token,
      expiresAtMs: credential.expiresAtMs,
    };
    return credential.token;
  }

  private resolveCommand(sourceName: string): string {
    const command = this.config.command;
    if (isAbsolute(command)) {
      throw new AuthError(
        `exec auth for "${sourceName}" command must be repo-relative, not absolute: ${command}`,
      );
    }
    const resolved = resolvePath(this.repoRoot, command);
    const rel = relativePath(this.repoRoot, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new AuthError(
        `exec auth for "${sourceName}" command escapes the repo: ${command}`,
      );
    }
    return resolved;
  }
}

/** Build the provider for a source's declared auth (COMMAND_SPEC §8). */
export function createAuthProvider(
  auth: AuthSpec,
  options: { clock?: Clock; repoRoot?: string; execRunner?: ExecRunner } = {},
): AuthProvider {
  const clock = options.clock ?? systemClock;
  if (typeof auth === "object") {
    if (auth.type === "exec") {
      return new ExecProvider(
        auth,
        clock,
        options.repoRoot ?? process.cwd(),
        options.execRunner ?? spawnRunner,
      );
    }
    return new OAuthProvider(auth, clock);
  }
  switch (auth) {
    case "none":
      return new NoneAuthProvider();
    case "bearer-env":
      return new BearerEnvAuthProvider();
    case "oidc":
      throw new AuthError(
        'the "oidc" auth shorthand is reserved; use the oauth-client-credentials object form with assertion: oidc',
      );
    default:
      throw new AuthError(`unknown auth type "${String(auth)}"`);
  }
}
