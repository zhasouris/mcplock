#!/usr/bin/env sh
# Build the release artifacts inside the pinned dev image:
#   - the npm tarball (pnpm pack)
#   - standalone binaries for Linux, Windows, macOS (esbuild bundle -> pkg)
#   - SHA256SUMS over all of the above
# Outputs land in ./dist-release. Reproduce a release build locally with:
#   docker compose run --rm dev sh scripts/release-build.sh
set -eu

out=dist-release
rm -rf "$out" dist-bin
mkdir -p "$out" dist-bin

version=$(node -p "require('./package.json').version")
echo "building mcplock $version artifacts"

# 1) npm build + tarball
pnpm build
pnpm pack --pack-destination "$out"

# 2) self-contained CJS bundle (deps inlined) for the binary packager
pnpm exec esbuild src/index.ts \
  --bundle --platform=node --target=node20 --format=cjs \
  --outfile=dist-bin/mcplock.cjs

# 3) standalone binaries, one per target
npx --yes @yao-pkg/pkg dist-bin/mcplock.cjs \
  --targets node20-linux-x64,node20-win-x64,node20-macos-x64 \
  --out-path dist-bin/bin

for f in dist-bin/bin/*; do
  [ -e "$f" ] || continue
  case "$f" in
    *linux*) mv "$f" "$out/mcplock-$version-linux-x64" ;;
    *win*) mv "$f" "$out/mcplock-$version-windows-x64.exe" ;;
    *macos*) mv "$f" "$out/mcplock-$version-macos-x64" ;;
    *) : ;;
  esac
done

# 4) checksums over every artifact (compute to a temp, then move it in, so the
# sums file is never both read and written in the same pipeline)
sums=$(mktemp)
find "$out" -maxdepth 1 -type f -exec sha256sum {} + | sed "s|$out/||" >"$sums"
mv "$sums" "$out/SHA256SUMS"

echo "artifacts:"
ls -la "$out"
