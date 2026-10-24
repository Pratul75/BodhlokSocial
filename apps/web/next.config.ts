import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load the repo-root .env so every app shares one file in development.
try {
  for (const line of readFileSync(resolve(__dirname, "../../.env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
} catch {}

const config: NextConfig = {
  output: "standalone",
  // Trace files from the monorepo root so workspace packages land in the standalone build.
  outputFileTracingRoot: resolve(__dirname, "../.."),
  transpilePackages: ["@bodh/db", "@bodh/shared", "@bodh/guardrails", "@bodh/integrations"],
  serverExternalPackages: ["postgres", "@google-cloud/secret-manager", "@google-cloud/storage", "@google-cloud/bigquery"],
  poweredByHeader: false,
  // Fonts read at runtime by lib/compose.tsx.
  outputFileTracingIncludes: { "/*": ["./assets/fonts/**"] },
  // Local-only folders and repo files the server never reads in production.
  outputFileTracingExcludes: {
    "/*": ["../../.secrets/**", "../../.uploads/**", "../../infra/**", "../../docs/**", "../../.git/**", "../../packages/*/src/**/*.test.ts"],
  },
};

export default config;
