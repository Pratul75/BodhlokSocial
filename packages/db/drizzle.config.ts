import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

// drizzle-kit does not load .env on its own; read the repo root one if present.
try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
} catch {}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh" },
});
