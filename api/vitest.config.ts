import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: ["src/db/migrations/**"],
    },
  },
});
