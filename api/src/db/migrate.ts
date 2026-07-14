import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIGRATION_LOCK_NAME = "sdm-dashboard-schema-migration";

export type MigrationExecutor = (client: PoolClient) => Promise<void>;

/**
 * Run schema migrations while holding a PostgreSQL advisory lock.
 *
 * The session-scoped lock serializes every migration runner that points at the
 * same database. Drizzle's migration journal makes re-runs idempotent.
 */
export async function runMigrationsWithClient(
  client: PoolClient,
  executeMigrations: MigrationExecutor,
): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
  let migrationError: unknown;
  try {
    await executeMigrations(client);
  } catch (error) {
    migrationError = error;
    throw error;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_NAME]);
    } catch (unlockError) {
      if (migrationError === undefined) throw unlockError;
      // The session is released by runMigrations() even if this explicit unlock
      // fails. Preserve the migration error, which is the actionable failure.
      console.error("[Migration] advisory unlock failed after migration failure:", unlockError);
    }
  }
}

export async function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_DIR
      ? resolve(process.env.DRIZZLE_MIGRATIONS_DIR)
      : resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
    await runMigrationsWithClient(client, async (lockedClient) => {
      await migrate(drizzle(lockedClient), { migrationsFolder });
    });
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMigrations()
    .then(() => console.log("[Migration] Completed successfully"))
    .catch((error: unknown) => {
      console.error("[Migration] Failed:", error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
}
