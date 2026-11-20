import { defineConfig } from "vitest/config";

// Provisioning a tenant applies ~200 DDL statements, so the setup hook needs room.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 180_000 } });
