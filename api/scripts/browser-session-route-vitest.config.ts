import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/services/browser-session-route.integration.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
