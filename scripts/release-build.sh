#!/usr/bin/env sh
# Build the release artifacts inside the pinned dev image:
#   - the npm tarball (pnpm pack)
#   - standalone binaries for Linux, Windows, macOS (esbuild bundle -> pkg),
#     archived so the extracted binary is simply `mcplock` / `mcplock.exe`
#   - a Windows .msi that installs mcplock.exe to Program Files and adds PATH
#   - SHA256SUMS over everything
# Outputs land in ./dist-release. Reproduce a release build locally with:
#   docker compose run --rm dev sh scripts/release-build.sh
set -eu

out=dist-release
rm -rf "$out" dist-bin
mkdir -p "$out" dist-bin

version=$(node -p "require('./package.json').version")
echo "building mcplock $version artifacts"

# 0) deps — the mounted node_modules volume is empty on a fresh CI runner,
# so install first (same as scripts/ci-verify.sh)
pnpm install --frozen-lockfile

# 1) npm build + tarball
pnpm build
pnpm pack --pack-destination "$out"

# 2) self-contained CJS bundle (deps inlined) for the binary packager;
# src/bin.ts is the executable entry that actually runs the CLI
pnpm exec esbuild src/bin.ts \
  --bundle --platform=node --target=node20 --format=cjs \
  --outfile=dist-bin/mcplock.cjs

# 3) standalone binaries, then stage each under its clean runnable name
npx --yes @yao-pkg/pkg dist-bin/mcplock.cjs \
  --targets node20-linux-x64,node20-win-x64,node20-macos-x64 \
  --out-path dist-bin/bin

for f in dist-bin/bin/*; do
  [ -e "$f" ] || continue
  case "$f" in
    *linux*)
      mkdir -p dist-bin/stage/linux-x64
      cp "$f" dist-bin/stage/linux-x64/mcplock
      ;;
    *macos*)
      mkdir -p dist-bin/stage/macos-x64
      cp "$f" dist-bin/stage/macos-x64/mcplock
      ;;
    *win*)
      mkdir -p dist-bin/stage/windows-x64
      cp "$f" dist-bin/stage/windows-x64/mcplock.exe
      ;;
    *) : ;;
  esac
done
chmod +x dist-bin/stage/linux-x64/mcplock dist-bin/stage/macos-x64/mcplock

# 4) archives — the extracted binary is exactly `mcplock` / `mcplock.exe`
tar -C dist-bin/stage/linux-x64 -czf "$out/mcplock-$version-linux-x64.tar.gz" mcplock
tar -C dist-bin/stage/macos-x64 -czf "$out/mcplock-$version-macos-x64.tar.gz" mcplock
zip -qj "$out/mcplock-$version-windows-x64.zip" dist-bin/stage/windows-x64/mcplock.exe

# The Windows .msi is built separately on a Windows runner (WiX) — see the
# `windows-msi` job in .github/workflows/release.yml — and attached to the
# same release. It wraps this exact mcplock.exe (uploaded from here).

# 5) checksums over every artifact (compute to a temp, then move it in, so the
# sums file is never both read and written in the same pipeline)
sums=$(mktemp)
find "$out" -maxdepth 1 -type f -exec sha256sum {} + | sed "s|$out/||" >"$sums"
mv "$sums" "$out/SHA256SUMS"

echo "artifacts:"
ls -la "$out"
