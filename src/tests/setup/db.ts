import { Pool } from "pg";
import { assertSafeDatabaseTarget } from "../../lib/db-safety";

/**
 * Integration tests need a real PostgreSQL instance. Rather than hard-failing when
 * DATABASE_URL isn't reachable (e.g. a contributor's machine without Postgres running), the
 * affected test suites are skipped with a clear console notice — `pnpm test` still exits 0 for
 * the parts of the suite that don't need a database.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;

  // Defence in depth: every DB-backed suite calls this at the top of its file, before its first
  // fixture. The setup file already enforces the same rule, but this keeps the guarantee even if a
  // suite is run with a config that bypasses `setupFiles`. Throws (never connects) for a
  // non-local database; the message contains the host only, never the URL or credentials.
  assertSafeDatabaseTarget({
    purpose: "integration tests",
    databaseUrl: connectionString,
    nodeEnv: process.env.NODE_ENV,
    allowedRemoteHost: process.env.TEST_DATABASE_ALLOWED_HOST,
    overrideVariable: "TEST_DATABASE_ALLOWED_HOST",
  });

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 2000 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
