#Requires -Version 5.1
<#
.SYNOPSIS
  Live smoke tests: run mcplock against REAL MCP servers.

.DESCRIPTION
  Runs the mcplock live suite (test/live/*.live.test.ts) inside the dev
  container with MCPLOCK_LIVE=1. The tests spawn published versions of the
  official reference server @modelcontextprotocol/server-everything over its
  native streamable-HTTP transport and drive mcplock against them — real
  protocol, real transport, real version-to-version schema drift.

  Self-contained: no external endpoint, no Docker MCP gateway, no API keys.
  NOT part of the hermetic green-commit gate (scripts/ci-verify.sh); the tests
  are skipped there because MCPLOCK_LIVE is unset.

  First run downloads the server packages (cached in a volume for later runs).

.EXAMPLE
  powershell -File scripts/live-smoke.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }

Write-Step "Checking Docker is running..."
docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker is not running. Start Docker Desktop and retry." }

Write-Step "Building the dev image (cached)..."
docker compose build dev | Out-Null

Write-Step "Running the mcplock live suite against real MCP servers..."
# --no-file-parallelism: live tests share port 3001, so run files serially.
docker compose run --rm -e MCPLOCK_LIVE=1 dev `
    pnpm exec vitest run test/live --no-coverage --no-file-parallelism
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
    Write-Host "LIVE SUITE: PASS" -ForegroundColor Green
}
else {
    Write-Host "LIVE SUITE: FAIL (exit $code)" -ForegroundColor Red
}
exit $code
