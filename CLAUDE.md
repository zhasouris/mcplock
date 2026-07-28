# CLAUDE.md — mcplock

Working instructions for Claude Code in this repository. The normative build
plan is [`docs/PLAN.md`](docs/PLAN.md); the CLI contract is
[`docs/COMMAND_SPEC.md`](docs/COMMAND_SPEC.md). This file adds the engineering
guidelines that both assume.

## Guidelines

### Environment — Docker containers only

- **Never run the toolchain against host binaries.** `pnpm`, `node`, `vitest`,
  `tsup`, `eslint`, and every test/build/lint command run **inside a pinned
  Docker image** (Node 20 + pnpm, tag pinned by digest). The host is assumed to
  have only Git — do not depend on a host Node install.
- The dev image is defined once (`Dockerfile` + `docker-compose.yml` or a
  `.devcontainer`) and is the **same image CI uses**. "Works on my machine" is
  not a valid state; "works in the image" is.
- A commit is "green" only when `pnpm lint && pnpm test && pnpm build` passes
  **inside that image**. Wrap it in a script (see `scripts/`) so the green-commit
  gate is one command, identically on a laptop and in CI.

### Testing

- **Hermetic by construction.** Tests never touch a real network or a real MCP
  server. The MCP surface is driven by an **in-process dummy HTTP client /
  fixture server** (Phase 2, commit 1) that is *scriptable and mutable
  mid-test* — that is how drift is produced: script a tool set, snapshot/pin it,
  mutate a schema or a description, assert the exact drift class and exit code.
  Every `structural | semantic | missing | undeclared | clean` case has a test
  that simulates it this way.
- **Determinism is under test.** Identical inputs must produce byte-identical
  lockfiles and generated code. Golden-file tests assert the bytes; all
  non-determinism (clocks, ordering, randomness) is injected so it can be
  pinned. `resolvedAt` and any UUID/nonce come from an injected port, never a
  direct `Date.now()`/`Math.random()`.
- **Coverage floor 82%, target 90%.** CI fails below **82%** line/branch
  coverage; **90%** is the standing target for `src/core`, `src/schema`, and the
  hashing/canonicalization code (the frozen semantics). Coverage is a floor, not
  a goal — do not chase the number with assertion-free tests, and do not exclude
  files to inflate it. Justify every coverage-ignore comment.
- **DAST — dynamic security testing of the untrusted surface.** mcplock talks to
  remote servers it does not control, so a dynamic suite exercises the CLI
  against **deliberately hostile MCP server responses** (served by the fixture /
  a throwaway container):
  - malformed, oversized, and deeply-nested `tools/list` payloads → the client
    enforces response-size and JSON-depth limits, and fails cleanly (exit `3`,
    source named) rather than hanging or OOMing;
  - **secret non-leakage**: assert credentials never appear in the lockfile,
    manifest, generated code, reports, or logs at any verbosity;
  - **SSRF / redirect discipline**: unexpected cross-host redirects are not
    followed; TLS verification is never silently disabled;
  - **exec-auth constraint**: absolute-path and `$PATH` command lookups are
    rejected, per spec §8.
  Run it in CI (Docker) and gate releases on it.
- **Mutation testing (Stryker).** Coverage proves a line ran; mutation score
  proves a test would have failed if that line were wrong — the real check that
  the hermetic drift tests actually catch drift. Gate `src/core`
  (hashing/classification) on a **mutation-score threshold**; treat it as more
  authoritative than the line-coverage floor.
- **Property-based tests (fast-check)** for canonicalization and hashing. The
  RFC 8785 and dual-hash rules are *invariants*, not example rows — fuzz them:
  `canon(canon(x)) === canon(x)`, hash stability under key reordering, "a
  structural edit flips only the structural hash; a semantic edit flips only the
  semantic hash."
- **Deterministic clock/RNG port, enforced by lint.** An eslint rule bans raw
  `Date.now()`, `Math.random()`, and `new Date()` outside the single injected
  time/entropy port, so byte-identical output cannot regress silently.
- **Cross-platform CI matrix (Linux / macOS / Windows).** "Byte-identical" dies
  on CRLF. Pin golden files and `*.lock` to LF via `.gitattributes`, and prove
  identical bytes on all three OSes — the primary dev machine is Windows.
- **Testcontainers integration tier.** One level above the in-process fixture:
  run the CLI against a genuine MCP server in a throwaway container to catch
  transport, pagination, and auth bugs the fixture cannot reproduce.
- **Fingerprint-stability contract test.** Assert the dedup guarantee directly:
  the same drift yields the same fingerprint across two runs *and across OSes*;
  resolved drift makes the fingerprint disappear. This is the contract
  `mcplock-action` consumes (spec §7).

### Repository layout

- **`scripts/`** holds repo- and project-level automation — the Docker
  green-commit wrapper, coverage/DAST/mutation runners, release helpers, and any
  developer convenience scripts. It is tracked via `scripts/.gitkeep` even when
  otherwise empty. Prefer adding a small script here over documenting a
  multi-step manual command. Convention: POSIX `sh`, named `scripts/ci-*.sh` for
  CI entry points, and **linted by shellcheck** in CI so the automation is
  itself tested.

### CI and supply chain

- **Same image, every stage.** lint, test (coverage), DAST, and mutation all run
  in the pinned dev image; a `.devcontainer` makes that image one-click for
  contributors (and for a future Node-capable machine).
- **Supply-chain checks in CI**: `pnpm audit`, lockfile-integrity verification,
  and npm provenance on publish (provenance already in the plan's release
  phase).

## Hard rules (from the plan — do not relax)

- One branch per phase, linear merges, **merge commits never squash**. Never
  commit directly to `main` during implementation.
- One commit per plan sub-item; **every commit is green and ships its own
  tests**. No "fix tests later" commits.
- TypeScript `strict`; no `any` without a justifying comment. Zod schemas are
  the single source of truth for every file format.
- Scope gate: nothing that runs as a service, holds credentials beyond a single
  `tools/list` call, invokes a tool, or resolves at the consumer's runtime. See
  the README's "What it is not".
