# mcplock — Implementation Plan

**Repo:** `mcplock` (CLI). The GitHub Action lives in a separate repo (`mcplock-action`) with its own, smaller plan, and cannot start until this repo cuts a release.
**Companion docs:** `docs/COMMAND_SPEC.md` (normative CLI contract), `README.md` (value proposition).
**Execution model:** single long-running Claude Code session, phases executed sequentially.

---

## 1. Tooling decisions (fixed)

| Concern | Choice |
|---------|--------|
| Runtime / language | Node 20+, TypeScript `strict` |
| Package manager | pnpm |
| CLI parsing | commander |
| Tests | vitest |
| Build | tsup |
| Schema validation | zod (manifest, lockfile, drift report) — runtime validation and JSON Schema emission from one source |
| Lint/format | eslint + prettier |
| Release | changesets, manual-dispatch publish workflow, npm provenance |

Package name `mcplock` — confirmed available on npm (2026-07-28). `mcp-lock` is squatted by an unrelated 0.0.1 namespace package; no functional collision.

## 2. Branch and commit discipline

- One branch per phase: `phase-1-foundation`, `phase-2-resolution`, …
- `phase-1` branches from `main`. Each subsequent phase branches from the previous phase's tip until that phase merges; after `phase-N → main` merges, `phase-N+1` rebases onto `main` before continuing.
- **Merge order is strictly linear: `phase-1 → main`, then `phase-2 → main`, and so on.** Merge commits, never squash — the commit granularity is the point.
- One commit per sub-item. **Every commit contains its own tests and every commit is green** (`pnpm lint && pnpm test && pnpm build`). No "add tests later" commits, no red intermediate states.
- Conventional commit messages (`feat(core): …`, `test(fixture): …`).
- `main` is protected in spirit: nothing lands on it except phase merges, each of which requires human review of the phase branch first.

## 3. Definition of done, per phase

1. Every listed commit exists, green, with tests.
2. Command behaviour matches `docs/COMMAND_SPEC.md`; any deliberate deviation is a spec PR in the same phase, not silent divergence.
3. The phase-end review checklist (per phase below) is satisfied.
4. Human approves; branch merges to `main`.

---

## 4. Phases

### Phase 1 — Foundation (branch `phase-1-foundation`)

Pure domain logic. No network, no CLI surface. Everything here is deterministically testable, which is why it goes first.

| # | Commit | Tests that must accompany it |
|---|--------|------------------------------|
| 1 | `chore: scaffold` — pnpm workspace, TS strict, vitest, tsup, eslint/prettier, CI workflow (lint+test+build on PR) | Smoke test proving the harness runs |
| 2 | `feat(schema): manifest` — zod schema + loader for `mcp-tools.yaml` | Valid/invalid fixture matrix: unknown keys, missing source refs, bad auth types |
| 3 | `feat(schema): lockfile` — zod schema + serializer with stable key ordering | Round-trip identity; byte-identical output for identical input |
| 4 | `feat(core): canonicalization` — RFC 8785 canonical JSON | Key ordering, unicode, number formatting vectors |
| 5 | `feat(core): dual hashing` — structural hash (name + inputSchema + outputSchema + annotations), semantic hash (title + description) | Known vectors; description edit flips *only* semantic; schema edit flips *only* structural; annotation edit flips structural |
| 6 | `feat(core): drift classification` — compare locked vs live tool sets → `structural` / `semantic` / `missing` / `undeclared` / `clean` | One test per class plus combinations |
| 7 | `feat(core): fingerprints` — per COMMAND_SPEC §fingerprints | Determinism across runs; new change ⇒ new fingerprint; resolved drift ⇒ fingerprint disappears |
| 8 | `feat(report): drift report` — JSON document (schemaVersion 1) + per-item markdown renderer | Snapshot tests; emitted JSON validates against the zod schema |

**Phase-end review:** hashing and classification behaviour signed off against the spec — these are the semantics everything else inherits, and they are effectively frozen once the lockfile format ships.

### Phase 2 — Resolution (branch `phase-2-resolution`)

First network, first CLI surface.

| # | Commit | Tests |
|---|--------|-------|
| 1 | `test(fixture): MCP fixture server` — in-process streamable-HTTP server with scriptable tool sets, mutable mid-test | Fixture self-test; this server underpins every e2e test in the repo |
| 2 | `feat(mcp): client` — streamable HTTP, `tools/list` with pagination, timeouts | Against fixture: pagination, timeout, malformed response |
| 3 | `feat(auth): provider interface + none + bearer-env` | Env var naming rules (`MCPLOCK_TOKEN_<SOURCE>`), missing-var error message |
| 4 | `feat(auth): oauth-client-credentials` — secret mode and federated-assertion (RFC 7523) mode | Mock token endpoint: token caching, expiry, error taxonomy |
| 5 | `feat(auth): exec` — repo-relative command constraint, JSON credential contract | Constraint enforcement (absolute path and `$PATH` lookup rejected), malformed output, non-zero exit |
| 6 | `feat(resolve): engine` — manifest → live defs → lockfile write; undeclared-tool warning; missing-tool error with near-miss suggestions | Full matrix against fixture |
| 7 | `feat(cli): skeleton` — commander wiring, global options, error taxonomy, exit codes incl. usage errors | Exit-code conformance tests from the spec table |
| 8 | `feat(cli): init, add, remove` | e2e against fixture; `--force`, `--no-generate` (no-op until Phase 4, flag accepted now so scripts are stable) |
| 9 | `feat(cli): resolve, list --offline` | e2e: lockfile written, deterministic bytes on repeat |

**Phase-end review:** run the CLI by hand against the fixture; auth provider set matches spec; `--frozen` deliberately absent (Phase 3).

### Phase 3 — Verification (branch `phase-3-verification`)

The product's reason to exist.

| # | Commit | Tests |
|---|--------|-------|
| 1 | `feat(cli): verify` — live-vs-lock comparison, `--semantic warn|fail|ignore`, exit codes 0/1/2/3 | Drift matrix e2e: mutate fixture per class, assert exact exit code |
| 2 | `feat(cli): verify reports` — `--report` (markdown) and `--report-json` | Snapshots; JSON validates; fingerprint stability across two consecutive runs |
| 3 | `feat(cli): diff` — human-readable, `--tool`, `--semantic-only` | Snapshots |
| 4 | `feat(cli): why` | Output includes source, hashes, scopes, timestamps |
| 5 | `feat(cli): update [tool]` — re-pin, `--dry-run` | Dry-run writes nothing; targeted update leaves other pins byte-identical |
| 6 | `feat(cli): resolve --frozen` | Fails without writing when resolution differs |

**Phase-end review:** the demo path works — mutate the fixture's schema, `verify` exits 1 with a structural diff; reword a description, exits 0 with a semantic warning; `--semantic fail` exits 2. This is the thirty seconds the whole project is for.

### Phase 4 — Codegen (branch `phase-4-codegen`)

| # | Commit | Tests |
|---|--------|-------|
| 1 | `feat(codegen): TS types` — inputSchema → TypeScript types | Generated output is **compiled inside the test** with strict TS; type-level assertions |
| 2 | `feat(codegen): typed client` — per-tool methods over an injected MCP transport | Generated client invokes fixture tools successfully; unknown-parameter is a compile error |
| 3 | `feat(cli): generation wiring` — into `add`/`resolve`/`update`; `--no-generate` becomes functional | e2e: files land in configured output dir; deterministic bytes |
| 4 | `feat(cli): check-generated` | Three tamper cases from spec: edited generated file, hand-edited lockfile, CLI version skew — each fails with the right message |

**Phase-end review:** a sample consumer package in `examples/` compiles against the generated client. dotnet codegen target explicitly deferred (post-1.0, likely alongside the action).

### Phase 5 — Release hardening (branch `phase-5-release`)

| # | Commit | Tests |
|---|--------|-------|
| 1 | `chore: packaging` — bin wiring, `npx mcplock` path, `engines`, minimal published file set | Pack-and-execute smoke test (`npm pack` → run from tarball) |
| 2 | `feat(dx): output polish` — TTY detection, `--no-color`, `--quiet`, `--json` everywhere it's promised | Non-TTY output contains no ANSI |
| 3 | `test(spec): conformance` — parse `docs/COMMAND_SPEC.md` option tables and diff against commander's registered commands/options | Spec drift fails CI — the spec stays true by construction |
| 4 | `chore(release): changesets + publish workflow` — manual dispatch, npm provenance | Workflow dry-run |
| 5 | `docs: final pass` — README claims verified against actual behaviour | — |

**Phase-end review:** `v0.1.0` published. This unblocks the `mcplock-action` repo.

---

## 5. Explicitly deferred

- **`mcplock-action` repo** — after `v0.1.0`; verify + `check-generated` + issue-creation mode driven by the `--report-json` contract.
- **Marketplace publication** — after the action has been dogfooded in at least one real workflow; not a day-1 item.
- **dotnet codegen target**, **registry providers (Azure API Center, official MCP Registry)**, **compatibility classification / forward chains**, **package-pinned stdio resolution** — in that rough order, each gated on demand signals rather than speculation.

## 6. Risks carried into execution

| Risk | Disposition |
|------|-------------|
| Auth to real servers for `tools/list` (R1) | Not blocking: fixture-driven development decouples the build from it. Must be answered before dogfooding against a real server in Phase 5. |
| Schema canonicalization false positives | Phase 1 commit 4/5 test vectors; extend with real-world schemas as encountered. |
| MCP spec adds native tool versioning | Lockfile `schemaVersion` field is the adaptation seam; monitor, don't pre-build. |
| Scope creep toward runtime features | The "What mcplock is not" section of the README is a hard gate; anything requiring a running service is rejected at review. |
