import { Pool } from "pg";
import { logger } from "@/lib/logger";

/**
 * The one place the connection pool is configured (kept apart from `client.ts`, which also loads the whole
 * schema, so its settings can be unit-tested without that import cost).
 *
 * - `connectionTimeoutMillis`: fail fast with an error the caller can handle instead of queueing forever when the
 *   pool/database is saturated.
 * - `idleTimeoutMillis`: let a serverless instance drop idle connections instead of holding them.
 * - an `error` listener: an idle client that errors (a dropped connection, a database restart) is emitted on the
 *   pool; with no listener Node treats it as an uncaught exception and takes the process down.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 });
  pool.on("error", (error) => logger.error({ err: error }, "Unexpected error on an idle database client"));
  return pool;
}
