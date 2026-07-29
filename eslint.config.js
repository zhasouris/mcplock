import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Determinism is a feature under test (CLAUDE.md): raw time/entropy are banned
// so byte-identical lockfiles and generated code cannot regress silently. Use
// the injected clock/entropy port instead (lands in a later Phase 1 commit).
const determinismRules = {
  "no-restricted-globals": [
    "error",
    {
      name: "Date",
      message:
        "Use the injected clock port; raw Date breaks determinism (CLAUDE.md).",
    },
  ],
  "no-restricted-properties": [
    "error",
    {
      object: "Date",
      property: "now",
      message: "Use the injected clock port (CLAUDE.md).",
    },
    {
      object: "Math",
      property: "random",
      message: "Use the injected entropy port (CLAUDE.md).",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date']",
      message:
        "Use the injected clock port; raw new Date() breaks determinism (CLAUDE.md).",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "dist-bin/",
      "dist-release/",
      "coverage/",
      "node_modules/",
      ".stryker-tmp/",
      "packaging/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: determinismRules,
  },
  prettier,
);
