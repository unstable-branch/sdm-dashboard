import { describe, expect, it } from "vitest";
import { assertProductionEnv } from "./production-env.js";

const strong = (letter: string) => letter.repeat(32);

const productionEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  JWT_SECRET: strong("j"),
  PLUMBER_INTERNAL_KEY: strong("i"),
  PLUMBER_EXECUTION_KEY: strong("e"),
  CSRF_SECRET: strong("c"),
  DATA_ENCRYPTION_KEY: strong("d"),
});

describe("production environment validation", () => {
  it("rejects a missing execution key", () => {
    const env = productionEnv();
    delete env.PLUMBER_EXECUTION_KEY;

    expect(() => assertProductionEnv(env)).toThrow(/PLUMBER_EXECUTION_KEY/);
  });

  it("rejects a weak execution key", () => {
    const env = productionEnv();
    env.PLUMBER_EXECUTION_KEY = "too-short";

    expect(() => assertProductionEnv(env)).toThrow(/PLUMBER_EXECUTION_KEY/);
  });

  it("requires the execution key to be independent from the internal key", () => {
    const env = productionEnv();
    env.PLUMBER_EXECUTION_KEY = env.PLUMBER_INTERNAL_KEY;

    expect(() => assertProductionEnv(env)).toThrow(/independent/);
  });

  it("accepts strong distinct production secrets", () => {
    expect(() => assertProductionEnv(productionEnv())).not.toThrow();
  });
});
