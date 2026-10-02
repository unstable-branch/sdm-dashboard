import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "src/middleware/auth.test.ts",
      "src/routes/auth.browser-session.test.ts",
      "src/routes/auth.test.ts",
      "src/services/sessions.logout.test.ts",
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
