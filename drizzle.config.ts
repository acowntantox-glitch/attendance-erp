import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Next.js itself auto-loads .env.local, but standalone CLIs (drizzle-kit, tsx scripts) don't —
// bare `dotenv/config` only loads `.env`, which this project doesn't use. Load .env.local
// explicitly, falling back to .env for CI/Docker where a plain .env is supplied instead.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://invalid:invalid@localhost:5432/invalid",
  },
  strict: true,
  verbose: true,
});
