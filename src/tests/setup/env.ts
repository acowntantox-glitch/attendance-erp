import { config } from "dotenv";
import { assertSafeDatabaseTarget } from "../../lib/db-safety";

/**
 * Test environment. Deliberately does NOT load `.env.local`: that file holds the developer's
 * runtime settings and can point at the production database, and the integration suite creates and
 * deletes companies/users/employees. (Earlier versions loaded `.env.local` first, and dotenv never
 * overrides an already-set variable — so the production DATABASE_URL silently won over the
 * `.env.test` placeholder.)
 *
 * Precedence, highest first — dotenv never overrides an existing variable:
 *   1. variables already in the process environment (CI sets DATABASE_URL to its Postgres service)
 *   2. `.env.test.local`  — git-ignored; put your real LOCAL test database URL here
 *   3. `.env.test`        — committed, placeholders only, so env validation never fails
 *
 * The guard below then refuses to continue unless DATABASE_URL is a local database (or a remote
 * host explicitly named in TEST_DATABASE_ALLOWED_HOST). It runs in the setup file, i.e. before any
 * test file — and therefore before any fixture — can touch the database.
 */
config({ path: ".env.test.local", quiet: true });
config({ path: ".env.test", quiet: true });

assertSafeDatabaseTarget({
  purpose: "integration tests",
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  allowedRemoteHost: process.env.TEST_DATABASE_ALLOWED_HOST,
  overrideVariable: "TEST_DATABASE_ALLOWED_HOST",
});
