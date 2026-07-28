import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Product code only; test/ holds fixtures/infra, not counted.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
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
