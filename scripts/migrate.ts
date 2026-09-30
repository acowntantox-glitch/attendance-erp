import "./load-env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db/client";
import { assertSafeDatabaseTarget } from "../src/lib/db-safety";

async function main() {
  // Local and CI databases migrate as before. A remote database (production) is allowed only when the
  // operator explicitly names its exact hostname, so a stray `pnpm db:migrate` with a production
  // DATABASE_URL in .env.local can no longer run by accident. NODE_ENV=production is NOT refused:
  // real deployments migrate with it set.
  const { host } = assertSafeDatabaseTarget({
    purpose: "database migration",
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    allowedRemoteHost: process.env.MIGRATE_ALLOW_REMOTE_HOST,
    overrideVariable: "MIGRATE_ALLOW_REMOTE_HOST",
    remoteRefusal: "Migrating a remote database requires explicit confirmation.",
  });
  console.log(`Migration target host: ${host}`);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
