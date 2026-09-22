import { config } from "dotenv";

// dotenv's config() never overrides a variable already present in process.env, so loading
// .env.local first lets a real local database take priority; .env.test then fills in safe
// placeholder values for anything still unset so env validation never fails in CI or on a
// machine without Postgres configured.
config({ path: ".env.local" });
config({ path: ".env.test" });
