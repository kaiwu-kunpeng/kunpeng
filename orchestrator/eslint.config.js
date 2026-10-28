// ESLint v9+ flat config (ESM). 鲲鹏 philosophy: catch real correctness problems,
// not impose style churn on the deliberately dense one-liner code style.
// Prettier owns formatting; eslint-config-prettier (last) turns off conflicting rules.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // Never lint build output or deps.
  { ignores: ["dist/**", "node_modules/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      // Goal rule of this task: forbid real `any`. Kept as an error.
      "@typescript-eslint/no-explicit-any": "error",

      // The dense one-liner style relies on inferred function return types and
      // occasional empty constructs; recommended set already omits the heavy
      // stylistic rules, so the relaxations below target the few that still
      // produce pre-existing noise rather than genuine bugs.

      // Allow leading-underscore params/vars to be intentionally unused
      // (common in callback/handler signatures here). Real unused symbols still error.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // Tests use throwaway shapes and stubs; `any` in test scaffolding is not a
    // correctness risk, so downgrade it to a warning there (kept an error in src).
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Must stay LAST: disables ESLint rules that would conflict with Prettier.
  prettier,
);
