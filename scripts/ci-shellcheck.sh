#!/usr/bin/env sh
# Lint the automation itself (CLAUDE.md). Runs inside the pinned dev image.
set -eu

shellcheck scripts/*.sh
