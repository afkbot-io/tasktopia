import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "data/**", "screenshots/**", "test-results/**", "playwright-report/**", "archive/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules, "react-hooks/set-state-in-effect": "off" },
  },
  {
    files: ["src/server/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "*.config.ts"],
    languageOptions: { globals: globals.node },
  },
);
