import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // server-only throws outside React Server Components; it's a no-op for tests.
      "server-only": fileURLToPath(new URL("./test/empty.ts", import.meta.url)),
    },
  },
  test: { include: ["**/*.test.ts"], exclude: ["node_modules/**", ".next/**"] },
});
