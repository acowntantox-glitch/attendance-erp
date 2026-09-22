import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });

if (!env.NODE_ENV || env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
/** The type of `tx` inside `db.transaction(async (tx) => ...)` — structurally close to but not
 *  identical to `Database` (missing `$client`), so functions that must work both standalone and
 *  inside a transaction should accept `DbExecutor`, not `Database`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbExecutor = Database | Transaction;
