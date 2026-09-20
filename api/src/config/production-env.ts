const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const required: Array<[string, number]> = [
    ["JWT_SECRET", MIN_PRODUCTION_SECRET_LENGTH],
    ["PLUMBER_INTERNAL_KEY", MIN_PRODUCTION_SECRET_LENGTH],
    ["PLUMBER_EXECUTION_KEY", MIN_PRODUCTION_SECRET_LENGTH],
    ["CSRF_SECRET", MIN_PRODUCTION_SECRET_LENGTH],
    ["DATA_ENCRYPTION_KEY", MIN_PRODUCTION_SECRET_LENGTH],
  ];
  const missing: string[] = [];
  for (const [name, minLen] of required) {
    const value = env[name];
    if (!value || value.length < minLen) missing.push(`${name} (>=${minLen} chars)`);
  }

  if (
    env.PLUMBER_INTERNAL_KEY &&
    env.PLUMBER_EXECUTION_KEY &&
    env.PLUMBER_INTERNAL_KEY === env.PLUMBER_EXECUTION_KEY
  ) {
    missing.push("PLUMBER_EXECUTION_KEY must be independent from PLUMBER_INTERNAL_KEY");
  }

  if (missing.length > 0) {
    const msg = `[FATAL] Missing or weak required secrets in production: ${missing.join(", ")}. Refusing to start.`;
    console.error(msg);
    throw new Error(msg);
  }
}
