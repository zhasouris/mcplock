/**
 * Auth providers (COMMAND_SPEC §8). mcplock authenticates only to *list* tools,
 * never to invoke them, and credentials never touch the manifest or lockfile.
 *
 * A provider turns a source + environment into the request headers the MCP
 * client attaches. This commit implements the two config-free providers:
 *   - `none`       — unauthenticated.
 *   - `bearer-env` — Bearer token from `MCPLOCK_TOKEN_<SOURCE>` (§9).
 * `oauth-client-credentials`, `oidc`, and `exec` land in the next commits.
 */

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

/**
 * Env var holding a source's bearer token: `MCPLOCK_TOKEN_<SOURCE>`, uppercased
 * with `-` → `_` (COMMAND_SPEC §8/§9). Source names are `[a-z0-9-]+`.
 */
export function tokenEnvVar(sourceName: string): string {
  return `MCPLOCK_TOKEN_${sourceName.toUpperCase().replace(/-/g, "_")}`;
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

/** Build the provider for a source's declared auth type (COMMAND_SPEC §8). */
export function createAuthProvider(type: string): AuthProvider {
  switch (type) {
    case "none":
      return new NoneAuthProvider();
    case "bearer-env":
      return new BearerEnvAuthProvider();
    case "oauth-client-credentials":
    case "oidc":
    case "exec":
      throw new AuthError(`auth type "${type}" is not yet implemented`);
    default:
      throw new AuthError(`unknown auth type "${type}"`);
  }
}
