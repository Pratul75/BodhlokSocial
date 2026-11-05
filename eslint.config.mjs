// One flat config for the whole workspace. `pnpm lint` runs it; CI fails on errors.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/next-env.d.ts", "packages/agents/src/skills.generated.ts", "infra/**", ".secrets/**", ".uploads/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Unused things are errors, except an intentionally ignored argument or rest sibling.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // Several SDK and DB results are typed loosely on purpose; casts are reviewed, not banned.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[object.name='process'][property.name='env'] > Identifier[name='ALLOW_DEV_AUTH']", message: "ALLOW_DEV_AUTH was removed: dev sign-in never runs in production." },
      ],
    },
  },
  {
    files: ["apps/web/**/*.tsx", "apps/web/components/**/*.ts"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin, "jsx-a11y": jsxA11y },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // App Router only; the rule is for the pages/ directory.
      "@next/next/no-html-link-for-pages": "off",
      "jsx-a11y/alt-text": "error",
    },
  },
  {
    // Scripts and seeds print progress for a person watching a terminal.
    files: ["scripts/**", "apps/worker/src/seed.ts", "packages/db/src/migrate.ts", "packages/agents/scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
