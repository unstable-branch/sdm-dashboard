import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://sdm:sdm_password@localhost:5432/sdm_platform";

export const db = drizzle(DATABASE_URL, { schema });

export type DB = typeof db;
