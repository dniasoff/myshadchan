// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".supabase-e2e", ".supabase-e2e-*", "supabase/.temp"] },
  {
    // A suppression that no longer suppresses anything fails the lint gate
    // instead of rotting silently (AC-10).
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx,mjs}"],
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.astro/**",
      "**/.supabase-e2e/**",
      "**/.supabase-e2e-*/**",
      "**/supabase/.temp/**",
    ],
    languageOptions: {
      ecmaVersion: 2020,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Node scripts and Claude Code hooks. TypeScript files rely on the
    // compiler for undefined identifiers; plain JS needs no-undef back on.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    files: [
      "src/components/admin/*.{ts,tsx}",
      "src/hooks/*.{ts,tsx}",
      "src/lib/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    files: ["src/components/ui/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    // Server/CLI code legitimately logs — a rule that's wrong for a whole
    // path is configured per path, never suppressed per line (AC-10).
    files: ["scripts/**/*.mjs", "supabase/functions/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // `supabase/functions/**` is a Deno runtime and is deliberately excluded
    // from every tsconfig (see tsconfig.node.json's own comment), so tsc never
    // sees it — and typescript-eslint turns `no-undef` OFF by default because
    // it normally trusts tsc to catch this. The result was a hole nothing
    // covered: a reference to a variable that no longer exists compiles,
    // lints, passes 208 unit tests, deploys, and fails at runtime in
    // production. That is not hypothetical — removing the demo's two-party
    // discussion left `connectionId` referenced two places further down and
    // the first anyone knew was `seed_demo failed: connectionId is not
    // defined` from a live seed.
    //
    // Turning it back on for exactly this directory restores the check tsc
    // would have made. Deno's own globals have to be declared, since there is
    // no tsconfig lib to supply them.
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      globals: {
        Deno: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        Blob: "readonly",
        File: "readonly",
        FormData: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        ReadableStream: "readonly",
        atob: "readonly",
        btoa: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        queueMicrotask: "readonly",
        structuredClone: "readonly",
        performance: "readonly",
        EventTarget: "readonly",
        Event: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    // These two run under NODE, not Deno: the vitest suite and the shim that
    // lets it stand in for Deno.env. They need Node's globals, not Deno's.
    files: [
      "supabase/functions/**/*.test.ts",
      "supabase/functions/_shared/denoEnvTestShim.ts",
    ],
    languageOptions: {
      globals: { Buffer: "readonly", process: "readonly" },
    },
  },
  storybook.configs["flat/recommended"],
);
