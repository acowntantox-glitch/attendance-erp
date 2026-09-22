import { Pool } from "pg";

/**
 * Integration tests need a real PostgreSQL instance. Rather than hard-failing when
 * DATABASE_URL isn't reachable (e.g. a contributor's machine without Postgres running), the
 * affected test suites are skipped with a clear console notice — `pnpm test` still exits 0 for
 * the parts of the suite that don't need a database.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;

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
