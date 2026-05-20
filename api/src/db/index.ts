import { drizzle } from "drizzle-orm/node-postgres";
import pg from "postgres";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://sdm:sdm_password@localhost:5432/sdm_platform";

export const sql = pg(DATABASE_URL);
export const db = drizzle(sql, { schema });

export type DB = typeof db;
