#!/usr/bin/env sh
# Sync the release version into the two sources of truth: package.json and
# src/version.ts. Runs inside the pinned dev image (needs node). Usage:
#   sh scripts/set-version.sh 1.2.3
set -eu

version="${1:-}"
if [ -z "$version" ]; then
  echo "usage: set-version.sh X.Y.Z" >&2
  exit 64
fi
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) : ;;
  *)
    echo "not a semver: $version" >&2
    exit 64
    ;;
esac

# package.json — 2-space indent + trailing newline keeps prettier happy.
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.version=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$version"

# src/version.ts — the single VERSION constant.
sed -i -E "s/export const VERSION = \"[^\"]*\";/export const VERSION = \"$version\";/" src/version.ts

echo "version set to $version (package.json + src/version.ts)"
