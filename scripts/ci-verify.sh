#!/usr/bin/env sh
# Green-commit gate. Runs inside the pinned dev image. A commit is green only
# when this passes (CLAUDE.md). Uses --frozen-lockfile so CI proves the
# committed lockfile is self-consistent.
set -eu

pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
