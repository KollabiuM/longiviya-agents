// ESLint flat config for the OpenCode plugin.
//
// Mirrors the frontend's convention (eslint.config.mjs in /frontend): flat
// config, typescript-eslint recommended, underscore-prefixed unused vars
// allowed. `lint` runs real ESLint here — `typecheck` is the separate
// `tsc --noEmit` path.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
);
