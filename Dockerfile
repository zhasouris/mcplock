# mcplock dev/CI image — the ONLY place the toolchain runs (host has Git only).
# Base: node:20-bookworm-slim, pinned by digest. Bump deliberately, never float.
FROM node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# shellcheck lints scripts/ (CLAUDE.md); ca-certificates for TLS to registries;
# zip packs the Windows release archive.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    shellcheck ca-certificates zip \
  && rm -rf /var/lib/apt/lists/*

# pnpm via npm rather than corepack — robust against corepack signature-key
# drift on pinned base images.
RUN npm install -g pnpm@9 && npm cache clean --force

WORKDIR /app
