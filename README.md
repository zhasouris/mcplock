# mcplock

![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)

Your agent has run clean in production for weeks — you haven't touched it, and you'd half forgotten it was even there. Then one day it starts reaching for the wrong tool on a task it used to nail, firing calls the server swats away as malformed, or cheerfully asking for a tool that no longer exists. Nothing in _your_ code has changed; your tests are still green and rather pleased with themselves. Upstream, though, an MCP server has quietly reworded a description, tightened an input schema, or renamed a tool out from under you — no version bump, no changelog, not so much as a sticky note — and your agent swallowed the change at runtime, on faith. Cue an afternoon spent bisecting perfectly innocent code before the penny drops: the ground moved, not your feet. That's life with an unpinned dependency — and your tool surface happens to be the one dependency in your whole stack you never got to pin.

**Lockfiles for MCP tool surfaces.** Pin the tools your agent depends on, verify them in CI, and turn drift into a red build with a diff attached — instead of a baffled agent improvising in front of a user.

```bash
npx mcplock init
npx mcplock add contracts.list_expiring --source contracts-api
npx mcplock resolve      # pin + generate a typed client
npx mcplock verify       # in CI: fail if the surface moved
```

<p align="center">
  <img src="assets/mcplock-flow.svg" width="760" alt="mcplock process flow: declare → resolve → verify → drift caught as a red build with a diff" />
</p>

---

## The problem

Your agent's tool surface is a dependency. It's also the only dependency in your stack you resolve at runtime, unpinned, on faith — which is a bold way to live, and one we've all quietly been living.

An MCP server can change a tool's input schema, and your agent starts sending malformed calls. It can reword a description, and the model quietly starts reaching for that tool in new situations — schema byte-identical, behaviour changed, and **no structural check anywhere will notice**. It can drop the tool entirely. In every case, today, you find out in production, which is the worst possible place to find out anything.

Nobody would put up with this for packages. We stopped resolving dependencies at runtime years ago; lockfiles won so thoroughly that the alternative now sounds faintly unhinged. MCP tool surfaces are dependencies with _worse_ failure modes — they drift in behaviour probabilistically instead of failing loudly — and somehow they still don't have a lockfile.

`mcplock` is the lockfile.

## What it does

- **Declare** the tools your application actually uses in `mcp-tools.yaml` — by name, per source, with version constraints.
- **Pin** them: `mcplock resolve` fetches the live definitions and writes `mcp-tools.lock`, recording two hashes per tool — one **structural** (schema + annotations), one **semantic** (description). Committed, diffable, and reviewed like any other dependency change.
- **Generate** a typed client, so every tool call in your codebase is checked against the pinned schema at compile time. An upstream parameter rename becomes a type error at your desk, not a mystery in production.
- **Verify** in CI: `mcplock verify` re-fetches the live surface and compares. Structural drift fails the build; semantic drift warns — or fails, your call. `mcplock check-generated` proves the committed client still tells the truth about the lockfile.
- **Report** drift as structured JSON with **deterministic fingerprints** — the same unresolved drift produces the same fingerprint on every run, which is what lets the [companion GitHub Action](https://github.com/zhasouris/mcplock-action) open _one_ issue per drift, keep it updated in place, and close it when resolved, instead of carpet-bombing your tracker every night.

## Why it matters

**It moves a whole class of failure from production to CI.** That's the entire pitch in one sentence. Schema drift shows up today as an agent quietly getting worse somewhere nobody is watching; with `mcplock` it shows up as a red build with an exact diff.

**It makes your evals mean something.** An agent evaluated against a tool set is only as trustworthy as that set is stable. If the surface can shift underneath the application, every eval result quietly carries an expiry date. Pinning is what upgrades evaluation from a demo into a control.

**It catches the drift nobody else even looks for.** Tool-selection accuracy lives and dies on description text. `mcplock` hashes descriptions separately from schemas, so a reworded description — invisible to every schema validator on earth — becomes a first-class, reportable event.

**It gives security a straight answer.** Which applications may call which tools, from which servers, with which scopes — answerable by reading one committed file per repo, instead of reconstructing it from tribal memory.

**And it gets along fine with dynamic tool loading.** Progressive disclosure (tool search, lazy schemas) tackles context bloat by picking tools at runtime — from whatever the server happens to offer _that day_. `mcplock` is the complement: the lockfile defines the universe, runtime selection plays within it. Deterministic bounds, dynamic selection, no tears.

## What it is not

- **Not a runtime component.** Nothing sits in your agent's request path. It's a CLI and two files, and it goes home at night.
- **Not a token broker.** It authenticates just far enough to list tools; it never invokes them.
- **Not a registry.** It happily consumes registries; it doesn't host one.
- **Not a policy engine.** It enforces the pins you chose, not opinions about what you should have pinned.

If a proposed feature needs a running service, it's out of scope by definition.

## Quick reference

| Command | Purpose |
|---------|---------|
| `init` / `add` / `remove` | Author the manifest |
| `resolve` | Pin everything; write lockfile + typed client |
| `verify` | CI: fail on drift (`--report-json` for automation) |
| `check-generated` | CI: committed client matches the lockfile |
| `update [tool]` | Deliberately accept an upstream change |
| `diff` / `why` / `list` | Inspect drift and pins |

Full contract — every option, exit code, file format, and the fingerprint algorithm — lives in [`docs/COMMAND_SPEC.md`](docs/COMMAND_SPEC.md).

## CI in two lines

```yaml
- run: npx mcplock verify --semantic warn --report-json drift.json
- run: npx mcplock check-generated
```

The first proves the world hasn't moved. The second proves your repo is being honest with itself. Together, a green build becomes a true statement about your tool surface — the kind you can trust at 4pm on a Friday.

Prefer to watch before you gate? The companion action's `fail-on: none` + `create-issues: true` files fingerprint-deduplicated issues on a schedule without breaking anyone's build — adopt the visibility first, add the gate once you trust it.

## Authentication

`none`, bearer-from-env, OAuth client credentials (including OIDC federated assertion — the no-secrets GitHub Actions → Entra ID path), and a kubectl-style `exec` escape hatch for everything else. Credentials never touch the manifest or the lockfile — not even by accident. Spec §8 has the details.

## Scope

v1: streamable HTTP servers. stdio resolution is deliberately excluded — verifying a stdio server means executing it, and a command pin names whatever happens to be installed on the current machine rather than a stable shared artifact. A package-pinned stdio mode is on the roadmap; a dishonest one is not.

## Tests

Everything runs in the pinned Docker image, so your laptop stays exactly as clean as you left it. The whole gate is one command, and CI runs that very same command on every push:

```bash
docker compose run --rm dev sh scripts/ci-verify.sh   # typecheck + lint + tests+coverage + build
```

### Hermetic suite (default — no network)

24 files, 263 tests, ~99% line coverage against an **82% CI floor** (the frozen core aims at 90%). Nothing here touches a real network or a real MCP server — it's drift in a controlled lab:

- **In-process fixture server** (`test/mcp/fixture-server.ts`) — scriptable and mutable _mid-test_. That is how every drift class is produced and asserted: script a tool set, pin it, mutate a schema or a description, then assert the exact drift class (`structural` / `semantic` / `missing` / `undeclared` / `clean`) and exit code.
- **DAST-style hostile responses** — fault knobs (`delay`, `malformed`, `sse`, `statusOverride`, `listError`) throw malformed, oversized, and slow `tools/list` payloads at the client; it must fail cleanly with the source named, never hang or leak.
- **Auth flows** run against a mock OAuth / GitHub-OIDC server (`test/auth/mock-oauth-server.ts`); secrets are asserted absent from lockfiles, reports, and logs.
- **Determinism is under test** — the clock/entropy port is injected, so lockfiles and fingerprints come out byte-identical across runs.

### Live suite (opt-in — real MCP servers)

Gated behind `MCPLOCK_LIVE=1` and **skipped by default**. Each test spins up a genuine MCP server over streamable-HTTP and runs `mcplock` end-to-end:

| Test | What it proves |
|------|----------------|
| [`everything-drift.live.test.ts`](test/live/everything-drift.live.test.ts) | Pins `server-everything` @ `2025.7.1`, verifies against `2026.7.4` → `structural` + `missing` + `undeclared` drift, exit `1`, stable fingerprints across runs. |
| [`everything-semantic.live.test.ts`](test/live/everything-semantic.live.test.ts) | `echo`'s description is reworded between `2025.8.18` → `2026.1.14` with the schema **byte-identical** → classified `semantic`; `--semantic warn\|fail\|ignore` exit codes honored. |
| [`cli-lifecycle.live.test.ts`](test/live/cli-lifecycle.live.test.ts) | Full lifecycle against a real server: `init → add → why → list → verify → resolve --frozen → diff → update → remove`. |
| [`cross-server.live.test.ts`](test/live/cross-server.live.test.ts) | A second server (`server-memory`, 9 tools) bridged stdio→HTTP via supergateway — transport, pagination, and protocol conformance the fixture can't reproduce. |

### Smoke runner

[`scripts/live-smoke.ps1`](scripts/live-smoke.ps1) runs the entire live suite in Docker with a single command (PowerShell) — it builds the dev image, sets `MCPLOCK_LIVE=1`, and executes the four live tests with coverage and file-parallelism off:

```powershell
./scripts/live-smoke.ps1
```

A quick gut-check that the CLI still behaves against real, shifting servers. Last run: **4/4 pass, ~25s**.

## License

MIT
