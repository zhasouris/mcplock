/**
 * Manifest schema and loader — `mcp-tools.yaml` (COMMAND_SPEC §5.1).
 *
 * Zod is the single source of truth for the file format (CLAUDE.md): every read
 * of a manifest goes through {@link parseManifest}. Unknown keys are rejected so
 * typos surface as errors rather than silent no-ops.
 */
import { readFileSync } from "node:fs";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { AuthSpecSchema } from "../auth/config";

/** `sources[].name` — unique, `[a-z0-9-]+` (COMMAND_SPEC §5.1). */
const SOURCE_NAME = /^[a-z0-9-]+$/;

/**
 * Header values are `${env:VAR}` interpolations only; literal secrets are
 * rejected so credentials never live in the manifest (COMMAND_SPEC §5.1, §8).
 */
const ENV_INTERPOLATION = /^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/;

/** `registry` is reserved (COMMAND_SPEC §10) — accepted by the schema, errors at use. */
const SourceType = z.enum(["direct", "registry"]);

const CodegenTarget = z.enum(["typescript", "dotnet"]);

const HeaderValue = z
  .string()
  .regex(
    ENV_INTERPOLATION,
    "header values must be a ${env:VAR} interpolation; literal secrets are rejected",
  );

const SourceSchema = z
  .object({
    name: z.string().regex(SOURCE_NAME, "source name must match [a-z0-9-]+"),
    type: SourceType.default("direct"),
    url: z.string().url("source url must be a valid URL"),
    auth: AuthSpecSchema.default("none"),
    headers: z.record(HeaderValue).optional(),
  })
  .strict();

const ToolSchema = z
  .object({
    name: z.string().min(1, "tool name is required"),
    source: z.string().min(1, "tool source is required"),
    constraint: z.string().default("*"),
  })
  .strict();

const CodegenSchema = z
  .object({
    target: CodegenTarget.default("typescript"),
    output: z.string().default("./generated"),
    namespace: z.string().optional(),
  })
  .strict();

/** Parsed, validated manifest. */
export const ManifestSchema = z
  .object({
    version: z.literal(1),
    // Empty is allowed: a freshly `init`-ed manifest has no sources yet.
    sources: z.array(SourceSchema).default([]),
    tools: z.array(ToolSchema).default([]),
    codegen: CodegenSchema.optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.sources.forEach((source, index) => {
      if (seen.has(source.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", index, "name"],
          message: `duplicate source name "${source.name}"`,
        });
      }
      seen.add(source.name);
    });

    const declared = new Set(manifest.sources.map((source) => source.name));
    manifest.tools.forEach((tool, index) => {
      if (!declared.has(tool.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools", index, "source"],
          message: `tool "${tool.name}" references unknown source "${tool.source}"`,
        });
      }
    });
  });

export type Manifest = z.infer<typeof ManifestSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Tool = z.infer<typeof ToolSchema>;

/** Raised for any unreadable, malformed, or invalid manifest (maps to exit 3). */
export class ManifestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ManifestError";
  }
}

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `  ${path}: ${issue.message}`;
  });
  return `invalid manifest:\n${lines.join("\n")}`;
}

/** Validate an already-parsed value against the manifest schema. */
export function parseManifest(data: unknown): Manifest {
  const result = ManifestSchema.safeParse(data);
  if (!result.success) {
    throw new ManifestError(formatIssues(result.error));
  }
  return result.data;
}

/** Read, YAML-parse, and validate a manifest file. */
export function loadManifest(filePath: string): Manifest {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new ManifestError(`cannot read manifest at ${filePath}`, { cause });
  }

  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (cause) {
    throw new ManifestError(`manifest at ${filePath} is not valid YAML`, {
      cause,
    });
  }

  return parseManifest(document);
}
