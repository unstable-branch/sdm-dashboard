import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const DB_POOL_SIZE = Math.max(1, parseInt(process.env.DB_POOL_SIZE || "10", 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://sdm:sdm_password@localhost:5432/sdm_platform",
  max: DB_POOL_SIZE,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || "10000", 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT_MS || "3000", 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "10000", 10),
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
