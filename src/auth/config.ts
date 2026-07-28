/**
 * Auth configuration schema (COMMAND_SPEC §8).
 *
 * `auth` in the manifest is either a string shorthand (config-free / env-derived
 * types) or an object carrying config. This commit adds the oauth-client-
 * credentials object; `exec` becomes an object variant in the next commit.
 * Secrets are never expressed here — only where to reach the token endpoint.
 */
import { z } from "zod";

/** Config-free / env-derived auth types expressible as a bare string. */
export const AUTH_SHORTHANDS = ["none", "bearer-env", "oidc"] as const;

/**
 * RFC 6749 client-credentials. Authenticates with a client secret (from env)
 * when `assertion` is absent, or an RFC 7523 JWT assertion when `assertion` is
 * `env` (JWT from env) or `oidc` (ambient GitHub-Actions OIDC token).
 */
export const OAuthConfigSchema = z
  .object({
    type: z.literal("oauth-client-credentials"),
    tokenUrl: z.string().url("oauth tokenUrl must be a valid URL"),
    clientId: z.string().min(1, "oauth clientId is required"),
    scope: z.string().optional(),
    audience: z.string().optional(),
    assertion: z.enum(["oidc", "env"]).optional(),
  })
  .strict();

/**
 * kubectl-style exec credential (COMMAND_SPEC §8). The command is repo-relative:
 * absolute paths and bare `$PATH` names are rejected here; repo-escape (`..`) is
 * rejected at run time (where the repo root is known).
 */
export const ExecConfigSchema = z
  .object({
    type: z.literal("exec"),
    command: z
      .string()
      .min(1)
      .refine((command) => command.includes("/") && !command.startsWith("/"), {
        message:
          "exec command must be repo-relative with a '/' separator (absolute paths and $PATH lookup are rejected)",
      }),
    args: z.array(z.string()).optional(),
  })
  .strict();

/** A source's `auth`: a shorthand string or an object config. */
export const AuthSpecSchema = z.union([
  z.enum(AUTH_SHORTHANDS),
  OAuthConfigSchema,
  ExecConfigSchema,
]);

export type AuthSpec = z.infer<typeof AuthSpecSchema>;
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;
export type ExecConfig = z.infer<typeof ExecConfigSchema>;
