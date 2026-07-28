# mcplock — Command Specification

**Status:** normative. The CLI implements this document; deviations are spec bugs or require a spec change in the same PR. A conformance test (Phase 5) diffs this document's option tables against the implemented command surface.

---

## 1. Invocation

```
mcplock <command> [arguments] [options]
```

Node 20+. Distributed on npm; executable via `npx mcplock`.

## 2. Global options

Valid on every command.

| Option | Default | Description |
|--------|---------|-------------|
| `--manifest <path>` | `./mcp-tools.yaml` | Manifest location |
| `--lockfile <path>` | `./mcp-tools.lock` | Lockfile location |
| `--verbose` | off | Debug logging to stderr |
| `--quiet` | off | Errors and final result only |
| `--no-color` | auto | Disable ANSI; auto-disabled when stdout is not a TTY |

## 3. Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success / clean |
| `1` | Structural drift, or `check-generated` mismatch |
| `2` | Semantic drift under `--semantic fail` |
| `3` | Resolution error: source unreachable, auth failure, malformed manifest or lockfile |
| `64` | Usage error: unknown command, bad flags, missing required argument |

`1` beats `2` when both classes are present in one run.

## 4. Commands

### 4.1 `init`

Scaffold a manifest in the current directory.

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--target <lang>` | no | `typescript` | Codegen target: `typescript` \| `dotnet` (dotnet reserved, errors until implemented) |
| `--output <dir>` | no | `./generated` | Generated-client directory |
| `--force` | no | off | Overwrite existing manifest |

Errors (`64`) if a manifest exists and `--force` absent.

### 4.2 `add <tool>`

Declare a tool, resolve it immediately, update lockfile and generated client.

| Argument / Option | Required | Default | Description |
|-------------------|----------|---------|-------------|
| `<tool>` | yes | — | Tool name as exposed by the server |
| `--source <name>` | if >1 source | sole source | Providing source |
| `--constraint <semver>` | no | `*` | Applied when the server publishes tool versions |
| `--no-generate` | no | off | Skip client regeneration |

Unknown tool ⇒ exit `3` with near-miss suggestions (case-insensitive Levenshtein ≤ 2 against the source's live tool names).

### 4.3 `remove <tool>`

Remove from manifest, lockfile, and generated client. `--no-generate` as above. Unknown tool ⇒ `64`.

### 4.4 `resolve`

Full resolution across all sources: fetch live definitions, verify constraints, write lockfile, regenerate client.

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--frozen` | no | off | Write nothing; exit `1` if resolution would change the lockfile |
| `--no-generate` | no | off | Lockfile only |
| `--source <name>` | no | all | Restrict to one source |
| `--json` | no | off | Machine-readable resolution report on stdout |

Undeclared live tools produce a warning, never a failure.

### 4.5 `verify`

Read-only CI check: re-fetch live definitions, compare to lockfile. Writes nothing except requested reports.

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--semantic <mode>` | no | `warn` | `warn` \| `fail` \| `ignore` |
| `--json` | no | off | Drift report JSON on stdout |
| `--report <path>` | no | — | Markdown drift report to file |
| `--report-json <path>` | no | — | Structured drift report (§6) to file — the contract consumed by `mcplock-action` |

Exit codes per §3. `--report*` files are written even on non-zero exit; that is their purpose.

### 4.6 `check-generated`

Regenerate into a temp directory; byte-diff against the committed client.

| Option | Description |
|--------|-------------|
| `--json` | Machine-readable diff summary |

Detects: hand-edited generated files, hand-edited lockfile, CLI version skew (generator version is stamped in a header comment and compared). Exit `0` clean, `1` mismatch, `3` error.

### 4.7 `update [tool]`

Deliberate re-pin: accept current live definitions as the new baseline.

| Argument / Option | Required | Default | Description |
|-------------------|----------|---------|-------------|
| `[tool]` | no | all | Restrict to one tool |
| `--dry-run` | no | off | Report what would change; write nothing |
| `--no-generate` | no | off | Skip regeneration |

A targeted update must leave every other lockfile entry byte-identical.

### 4.8 `diff`

Human-readable live-vs-lock report without failing (`verify` for humans; always exits `0` unless resolution error).

| Option | Description |
|--------|-------------|
| `--tool <name>` | Restrict to one tool |
| `--semantic-only` | Description/annotation changes only |

### 4.9 `why <tool>`

Explain a pin: source, version, structural and semantic hashes, required scopes (when derivable), forward chain (reserved), `resolvedAt`.

### 4.10 `list`

| Option | Description |
|--------|-------------|
| `--offline` | Lockfile only; no network |
| `--json` | Machine-readable |

Without `--offline`, includes live drift status per tool.

## 5. File formats

### 5.1 Manifest — `mcp-tools.yaml`

```yaml
version: 1
sources:
  - name: contracts-api          # unique, [a-z0-9-]+
    type: direct                 # direct | registry (registry reserved)
    url: https://mcp.internal.example/contracts
    auth: oidc                   # see §7
    headers:                     # optional escape hatch
      X-Api-Key: ${env:CONTRACTS_KEY}   # ${env:*} interpolation ONLY; literals rejected
tools:
  - name: contracts.list_expiring
    source: contracts-api
    constraint: "^2"
codegen:
  target: typescript
  output: ./generated
  namespace: acme/agents
```

### 5.2 Lockfile — `mcp-tools.lock`

Machine-generated JSON, stable key ordering, one entry per tool:

```json
{
  "schemaVersion": 1,
  "generatedBy": "mcplock@0.1.0",
  "tools": {
    "contracts.list_expiring": {
      "source": "contracts-api",
      "resolvedServer": "https://mcp.internal.example/contracts",
      "serverVersion": "2.1.0",
      "schemaHash": "sha256:…",
      "semanticHash": "sha256:…",
      "scopes": ["Contracts.Read"],
      "forwardChain": [],
      "resolvedAt": "2026-07-28T14:00:00Z"
    }
  }
}
```

Serialization is deterministic: identical inputs produce byte-identical files.

## 6. Drift report schema (`--report-json`)

```json
{
  "schemaVersion": 1,
  "generatedAt": "…",
  "manifest": "mcp-tools.yaml",
  "summary": { "structural": 0, "semantic": 0, "missing": 0, "undeclared": 0, "resolutionErrors": 0 },
  "items": [
    {
      "fingerprint": "a41f9c2e7d10b3a4",
      "tool": "…",
      "source": "…",
      "class": "structural | semantic | missing | undeclared | resolution-error",
      "locked": { "schemaHash": "…", "semanticHash": "…", "version": "…" },
      "live":   { "schemaHash": "…", "semanticHash": "…", "version": "…" },
      "changes": [ { "path": "inputSchema.properties.window", "kind": "type-changed", "from": "string", "to": "integer" } ],
      "markdown": "self-contained human-readable fragment"
    }
  ]
}
```

Consumers must reject unknown `schemaVersion`.

## 7. Hashing and fingerprints (normative)

- **Canonicalization:** RFC 8785 (JCS) canonical JSON.
- **Structural hash:** sha256 over canonical JSON of `{ name, inputSchema, outputSchema, annotations }`. Annotations (`readOnlyHint`, `destructiveHint`, etc.) are structural: they gate behaviour.
- **Semantic hash:** sha256 over canonical JSON of `{ title, description }`.
- **Fingerprint:** first 16 hex chars of sha256 over canonical JSON of `{ tool, class, locked.schemaHash, locked.semanticHash, live.schemaHash, live.semanticHash }`.

Guarantees: the same unresolved drift yields the same fingerprint on every run and runner; any further change to either side yields a new fingerprint; resolved drift ceases to appear. This is the deduplication contract for issue automation.

## 8. Authentication

| `auth` | Behaviour |
|--------|-----------|
| `none` | Unauthenticated |
| `bearer-env` | Bearer token from `MCPLOCK_TOKEN_<SOURCE_NAME>` (uppercase, `-`→`_`) |
| `oauth-client-credentials` | RFC 6749 client credentials against a configured token endpoint. Client secret from env, **or** federated assertion mode (RFC 7523) using an ambient OIDC token — the GitHub-Actions→Entra path. Config: `tokenUrl`, `clientId`, `audience`/`scope`, `assertion: oidc \| env` |
| `oidc` | Alias for `oauth-client-credentials` in assertion mode with `MCPLOCK_OIDC_AUDIENCE` |
| `exec` | Run a **repo-relative** command (absolute paths and `$PATH` lookup rejected); it prints `{ "token": "…", "expiresAt": "…" }` on stdout. kubectl exec-credential pattern |

Invariants: credentials never appear in manifest or lockfile; mcplock only ever calls `tools/list` and never invokes tools; token acquisition failures are exit `3` with the provider named.

## 9. Environment variables

| Variable | Purpose |
|----------|---------|
| `MCPLOCK_TOKEN_<SOURCE>` | bearer-env tokens |
| `MCPLOCK_OIDC_AUDIENCE` | Audience for `oidc` auth |
| `NO_COLOR` | Honored per convention |

## 10. Reserved for future versions

`sources[].type: registry` (Azure API Center, official MCP Registry), `codegen.target: dotnet`, `forwardChain` population and compatibility classes, package-pinned stdio resolution. Present in schemas where cheap so their later arrival is non-breaking; functionally erroring until implemented.
