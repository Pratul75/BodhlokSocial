import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests against a running app in dev sign-in mode (no Google client) on a seeded database.
 * CI starts `next dev` and the seed; locally: `pnpm db:up && pnpm db:migrate && SEED_CONFIRM=yes pnpm db:seed`,
 * then `pnpm --filter @bodh/web e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000/api/health", timeout: 180_000, reuseExistingServer: true },
});
