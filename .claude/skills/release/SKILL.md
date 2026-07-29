---
name: release
description: Cut a new mcplock release. Picks the next version (major/minor/patch), syncs it into package.json + src/version.ts, proves the tree green in the dev image, tags it, and drives the GitHub Actions release workflow that builds Linux/Windows/macOS binaries and the npm tarball. Use when the user says "create a release", "cut a release", "release a new version", or names a bump type.
---

# Release skill

Cut a mcplock release end to end: choose the next version, sync it into the two
sources of truth, prove the tree is green in the pinned dev image, tag it, and
let the `release` workflow build the artifacts and publish the GitHub Release.

**The tag is the trigger.** Pushing `vX.Y.Z` starts
[`.github/workflows/release.yml`](../../workflows/release.yml), which (1) re-runs
the green-commit gate, (2) builds the npm tarball and the standalone
Linux/Windows/macOS binaries via `scripts/release-build.sh`, and (3) creates the
GitHub Release with generated notes and every artifact attached. Your job runs up
to and including the tag push, then you watch the workflow and report the result.

## Preconditions — check first, stop if any fail

- On `main`, working tree clean, in sync with `origin/main` — `git status -sb`.
- Docker is running (the toolchain lives in the dev image).
- `gh` is authenticated — `gh auth status`.

## 1. Find the current version

- Read `version` from `package.json`.
- Read the latest tag: `git tag --list 'v*' --sort=-v:refname | head -n1`
  (empty ⇒ first release; the current `package.json` version is the base).
- If the tag and `package.json` disagree, surface it and ask which is
  authoritative before continuing.

## 2. Choose the bump

- If the user named it (major / minor / patch — "incremental" and "bugfix" mean
  patch), use it. Otherwise ask: major, minor, or patch?
- Compute the next version with SemVer from the current one:
  major ⇒ `X+1.0.0`, minor ⇒ `X.Y+1.0`, patch ⇒ `X.Y.Z+1`.
- Confirm in one line before proceeding — e.g. `0.3.1 → 0.4.0 (minor) — go?`
- First release (still `0.0.0`, no tags): minor ⇒ `0.1.0`, major ⇒ `1.0.0`,
  patch ⇒ `0.0.1`.

## 3. Set the version

Run in the dev image so both files move together:

```
docker compose run --rm dev sh scripts/set-version.sh X.Y.Z
```

This updates `package.json` and `src/version.ts` (the CLI's `--version`,
user-agent, and the lockfile's `generatedBy` all read the latter).

## 4. Prove it green

```
docker compose run --rm dev sh scripts/ci-verify.sh
```

Must pass — typecheck, lint, tests + coverage, build. Never tag a red tree.

## 5. Commit and tag

```
git add package.json src/version.ts
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "mcplock vX.Y.Z"
```

## 6. Push — this triggers the release

```
git push origin main --follow-tags
```

## 7. Watch and report

- Find the run: `gh run list --workflow release --limit 1`.
- Watch it: `gh run watch <id> --exit-status`.
- On success: report the version, the release URL (`gh release view vX.Y.Z`),
  and the attached assets.
- On failure: read `gh run view <id> --log-failed`, diagnose, fix on `main`. If
  only the build was at fault, re-run: `gh workflow run release -f tag=vX.Y.Z`.
  If the tagged commit itself needs a change, drop the tag
  (`git push origin :vX.Y.Z && git tag -d vX.Y.Z`), fix, and redo from step 4.

## Notes

- **Artifacts.** The release attaches the npm tarball (`mcplock-X.Y.Z.tgz`), the
  standalone binaries (`mcplock-X.Y.Z-linux-x64`, `-windows-x64.exe`,
  `-macos-x64`), and `SHA256SUMS`. All built in the dev image by
  `scripts/release-build.sh`; run that script the same way to reproduce locally.
- **npm publish is optional.** The workflow's `npm` job publishes only when the
  `NPM_TOKEN` secret exists; without it the GitHub Release still ships. Don't add
  the token yourself — that's the user's call.
- **Runnable binaries need the CLI entry.** The binaries wrap whatever
  `src/index.ts` bundles. Until the executable entry is wired (running the
  commander program from `src/cli/run.ts`), they build but don't execute
  commands. Flag this before cutting a real, user-facing release. See
  `docs/PLAN.md`.
