# mcplock

![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)

Your agent has run clean in production for weeks — you haven't touched it. Then it starts reaching for the wrong tool on a task it used to nail, firing calls the server rejects as malformed, or asking for a tool that no longer exists. Nothing in _your_ code has changed; your tests are still green. Upstream, an MCP server has quietly reworded a tool's description, tightened an input schema, or renamed a tool out from under you — no version bump, no changelog, no warning — and your agent swallows the change at runtime, on faith. You burn an afternoon bisecting your own code before it dawns on you that the ground moved. That is what happens when the MCP tooling sands shift beneath your feet: the break lands in front of a user, in the one dependency in your stack you never pinned.

**Lockfiles for MCP tool surfaces.** Pin the tools your agent depends on, verify them in CI, and turn drift into a red build with a diff attached — instead of an agent behaving oddly in front of a user.

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

Your agent's tool surface is a dependency — and it's the only dependency in your stack that you resolve at runtime, unpinned, on faith.

An MCP server can change a tool's input schema, and your agent starts sending malformed calls. It can reword a description, and the model quietly starts choosing that tool in different situations — schema byte-identical, behaviour changed, and **no structural check anywhere will catch it**. It can remove the tool entirely. In every case, today, you find out in production.

Nobody would accept this for packages. We stopped resolving dependencies at runtime years ago; lockfiles won so completely that the alternative sounds absurd. MCP tool surfaces are dependencies with *worse* failure modes — they change behaviour probabilistically rather than failing loudly — and no lockfile.

`mcplock` is the lockfile.

## What it does

- **Declare** the tools your application actually uses in `mcp-tools.yaml` — by name, per source, with version constraints.
- **Pin** them: `mcplock resolve` fetches live definitions and writes `mcp-tools.lock`, recording two hashes per tool — one **structural** (schema + annotations), one **semantic** (description). Committed, diffable, reviewed like any other dependency change.
- **Generate** a typed client, so every tool call in your codebase is compile-time checked against the pinned schema. An upstream parameter rename becomes a type error, not a runtime mystery.
- **Verify** in CI: `mcplock verify` re-fetches the live surface and compares. Structural drift fails the build. Semantic drift warns — or fails, your call. `mcplock check-generated` proves the committed client honestly matches the lockfile.
- **Report** drift as structured JSON with **deterministic fingerprints** — the same unresolved drift produces the same fingerprint on every run, which is what lets the [companion GitHub Action](https://github.com/zhasouris/mcplock-action) open *one* issue per drift, update it in place, and auto-close it when resolved, instead of spamming your tracker nightly.

## Why it matters

**It moves a class of failure from production to CI.** That's the whole argument in one sentence. Schema drift currently surfaces as degraded agent behaviour somewhere nobody is watching; after `mcplock`, it surfaces as a red build with an exact diff.

**It makes your evals mean something.** An agent evaluated against a tool set is only as trustworthy as that set's stability. If the surface can shift underneath the application, every eval result carries an unstated expiry date. Pinning is what upgrades evaluation from a demo into a control.

**It catches the drift nobody else even looks for.** Tool selection accuracy lives and dies on description text. `mcplock` hashes descriptions separately from schemas, so a reworded description — invisible to every schema validator — is a first-class, reportable event.

**It gives security an auditable answer.** Which applications may call which tools, from which servers, with which scopes — answerable by reading one committed file per repo, instead of tribal knowledge about runtime configuration.

**And it plays correctly with dynamic tool loading.** Progressive disclosure (tool search, lazy schemas) solves context bloat by selecting tools at runtime — from whatever the server offers *that day*. `mcplock` is the complement: the lockfile defines the universe, runtime selection operates within it. Deterministic bounds, dynamic selection.

## What it is not

- **Not a runtime component.** Nothing sits in your agent's request path. It's a CLI and two files.
- **Not a token broker.** It authenticates only to list tools; it never invokes them.
- **Not a registry.** It consumes registries; it doesn't host one.
- **Not a policy engine.** It enforces the pins you chose, not rules about what you may pin.

If a proposed feature requires a running service, it's out of scope by definition.

## Quick reference

| Command | Purpose |
|---------|---------|
| `init` / `add` / `remove` | Author the manifest |
| `resolve` | Pin everything; write lockfile + typed client |
| `verify` | CI: fail on drift (`--report-json` for automation) |
| `check-generated` | CI: committed client matches the lockfile |
| `update [tool]` | Deliberately accept an upstream change |
| `diff` / `why` / `list` | Inspect drift and pins |

Full contract — every option, exit code, file format, and the fingerprint algorithm — in [`docs/COMMAND_SPEC.md`](docs/COMMAND_SPEC.md).

## CI in two lines

```yaml
- run: npx mcplock verify --semantic warn --report-json drift.json
- run: npx mcplock check-generated
```

The first proves the world hasn't moved. The second proves your repo is internally honest. Together, a green build is a true statement about your tool surface.

Prefer monitoring before gating? The companion action's `fail-on: none` + `create-issues: true` files fingerprint-deduplicated issues on a schedule without breaking anyone's build — adopt the visibility first, add the gate when you trust it.

## Authentication

`none`, bearer-from-env, OAuth client credentials (including OIDC federated assertion — the no-secrets GitHub Actions → Entra ID path), and a kubectl-style `exec` escape hatch for everything else. Credentials never touch the manifest or lockfile. Spec §8 has the details.

## Scope

v1: streamable HTTP servers. stdio resolution is deliberately excluded — verifying a stdio server means executing it, and a command pin names whatever happens to be installed on the current machine rather than a stable shared artifact. A package-pinned stdio mode is on the roadmap; a dishonest one is not.

## License

MIT
