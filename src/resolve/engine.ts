/**
 * Resolution engine (PLAN Phase 2, commit 6) — the composition point.
 *
 * For each source that declares tools: build its auth provider, list the live
 * tool surface via the MCP client, then for every declared tool compute the
 * dual hashes and write a lockfile entry. Live tools that are not declared
 * produce a warning (never a failure, spec §4.4). A declared tool absent from
 * the live surface is a hard error with near-miss suggestions (case-insensitive
 * Levenshtein ≤ 2).
 *
 * The tool lister is injected so the engine is testable without real sockets;
 * the default builds an {@link McpClient} per source.
 */
import { createAuthProvider } from "../auth/provider";
import { msToIso, type Clock } from "../core/clock";
import { hashTool, type ToolHashes } from "../core/hash";
import { McpClient, type ListToolsResult } from "../mcp/client";
import {
  parseLockfile,
  type LockedTool,
  type Lockfile,
} from "../schema/lockfile";
import type { Manifest, Source, Tool } from "../schema/manifest";

/** Any resolution failure not already an AuthError/McpError (maps to exit 3). */
export class ResolveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ResolveError";
  }
}

/** Lists the live tools for a source, given resolved auth headers. */
export type ToolLister = (
  source: Source,
  authHeaders: Record<string, string>,
) => Promise<ListToolsResult>;

export interface ResolveOptions {
  manifest: Manifest;
  env: Record<string, string | undefined>;
  clock: Clock;
  /** Repo root, for exec-auth command resolution. */
  cwd: string;
  /** Stamped into the lockfile, e.g. `mcplock@0.1.0`. */
  generatedBy: string;
  /** Injected for tests; defaults to a real MCP client per source. */
  listTools?: ToolLister;
  timeoutMs?: number;
}

export interface ResolveResult {
  lockfile: Lockfile;
  warnings: string[];
}

const HEADER_INTERPOLATION = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** Resolve `${env:VAR}` manifest header values against the environment. */
export function resolveSourceHeaders(
  headers: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const match = HEADER_INTERPOLATION.exec(value);
    if (match === null) {
      throw new ResolveError(
        `header "${name}" must be a \${env:VAR} interpolation`,
      );
    }
    const variable = match[1]!;
    const envValue = env[variable];
    if (envValue === undefined) {
      throw new ResolveError(
        `header "${name}" references unset environment variable ${variable}`,
      );
    }
    resolved[name] = envValue;
  }
  return resolved;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[a.length]![b.length]!;
}

function nearMisses(target: string, candidates: string[]): string[] {
  const lowerTarget = target.toLowerCase();
  return candidates
    .map((name) => ({
      name,
      distance: levenshtein(lowerTarget, name.toLowerCase()),
    }))
    .filter((entry) => entry.distance <= 2)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )
    .map((entry) => entry.name);
}

export function defaultToolLister(
  env: Record<string, string | undefined>,
  timeoutMs: number | undefined,
): ToolLister {
  return (source, authHeaders) => {
    const client = new McpClient({
      url: source.url,
      headers: { ...authHeaders, ...resolveSourceHeaders(source.headers, env) },
      ...(timeoutMs !== undefined && { timeoutMs }),
    });
    return client.listTools();
  };
}

interface FetchContext {
  env: Record<string, string | undefined>;
  clock: Clock;
  cwd: string;
}

/** Build a source's auth provider, then list its live tools. */
async function fetchSource(
  source: Source,
  sourceName: string,
  ctx: FetchContext,
  listTools: ToolLister,
): Promise<ListToolsResult> {
  const provider = createAuthProvider(source.auth, {
    clock: ctx.clock,
    repoRoot: ctx.cwd,
  });
  const authHeaders = await provider.headers({ sourceName, env: ctx.env });
  return listTools(source, authHeaders);
}

function groupBySource(tools: Tool[]): Map<string, Tool[]> {
  const grouped = new Map<string, Tool[]>();
  for (const tool of tools) {
    const list = grouped.get(tool.source) ?? [];
    list.push(tool);
    grouped.set(tool.source, list);
  }
  return grouped;
}

/** Resolve the manifest into a lockfile plus any undeclared-tool warnings. */
export async function resolve(options: ResolveOptions): Promise<ResolveResult> {
  const { manifest, env, clock, cwd, generatedBy } = options;
  const listTools =
    options.listTools ?? defaultToolLister(env, options.timeoutMs);
  const resolvedAt = msToIso(clock());
  const warnings: string[] = [];
  const tools: Record<string, LockedTool> = {};

  const sourceByName = new Map(manifest.sources.map((s) => [s.name, s]));

  for (const [sourceName, declared] of groupBySource(manifest.tools)) {
    // Non-null: manifest validation guarantees every tool.source is declared.
    const source = sourceByName.get(sourceName)!;
    const live = await fetchSource(
      source,
      sourceName,
      { env, clock, cwd },
      listTools,
    );

    const liveByName = new Map(live.tools.map((t) => [t.name, t]));
    const declaredNames = new Set(declared.map((t) => t.name));

    for (const liveTool of live.tools) {
      if (!declaredNames.has(liveTool.name)) {
        warnings.push(
          `source "${sourceName}" offers undeclared tool "${liveTool.name}"`,
        );
      }
    }

    for (const decl of declared) {
      const liveTool = liveByName.get(decl.name);
      if (liveTool === undefined) {
        const suggestions = nearMisses(decl.name, [...liveByName.keys()]);
        const hint =
          suggestions.length > 0
            ? ` — did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?`
            : "";
        throw new ResolveError(
          `tool "${decl.name}" not found on source "${sourceName}"${hint}`,
        );
      }
      const { schemaHash, semanticHash } = hashTool(liveTool);
      tools[decl.name] = {
        source: sourceName,
        resolvedServer: source.url,
        ...(live.serverVersion !== undefined && {
          serverVersion: live.serverVersion,
        }),
        schemaHash,
        semanticHash,
        scopes: [],
        forwardChain: [],
        resolvedAt,
      };
    }
  }

  const lockfile = parseLockfile({ schemaVersion: 1, generatedBy, tools });
  return { lockfile, warnings };
}

export interface LiveToolInfo {
  hashes: ToolHashes;
  source: string;
  version?: string;
}

export interface CollectLiveOptions {
  manifest: Manifest;
  env: Record<string, string | undefined>;
  clock: Clock;
  cwd: string;
  listTools?: ToolLister;
  timeoutMs?: number;
}

/**
 * Fetch the live tool hashes across every source that declares tools, keyed by
 * tool name. Used by `list` (and later `verify`) to classify drift against the
 * lockfile without writing anything.
 */
export async function collectLiveTools(
  options: CollectLiveOptions,
): Promise<Map<string, LiveToolInfo>> {
  const listTools =
    options.listTools ?? defaultToolLister(options.env, options.timeoutMs);
  const ctx: FetchContext = {
    env: options.env,
    clock: options.clock,
    cwd: options.cwd,
  };
  const sourceByName = new Map(
    options.manifest.sources.map((s) => [s.name, s]),
  );
  const live = new Map<string, LiveToolInfo>();

  for (const sourceName of new Set(
    options.manifest.tools.map((t) => t.source),
  )) {
    // Non-null: manifest validation guarantees every tool.source is declared.
    const source = sourceByName.get(sourceName)!;
    const result = await fetchSource(source, sourceName, ctx, listTools);
    for (const tool of result.tools) {
      live.set(tool.name, {
        hashes: hashTool(tool),
        source: sourceName,
        ...(result.serverVersion !== undefined && {
          version: result.serverVersion,
        }),
      });
    }
  }
  return live;
}
