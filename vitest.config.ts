import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Product code only; test/ holds fixtures/infra, not counted.
      include: ["src/**/*.ts"],
      // bin.ts is the shebang launcher — a trivial process shim whose logic
      // (cli.ts, run.ts) is unit-tested; it can't run under vitest.
      exclude: ["src/**/*.test.ts", "src/bin.ts"],
      reporter: ["text", "lcov"],
      // Floor per CLAUDE.md; the frozen core aims at 90% (raised as it lands).
      thresholds: {
        lines: 82,
        functions: 82,
        branches: 82,
        statements: 82,
      },
    },
  },
});
