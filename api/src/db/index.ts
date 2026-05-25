import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://sdm:sdm_password@localhost:5432/sdm_platform",
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 3000,
  statement_timeout: 10000,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
