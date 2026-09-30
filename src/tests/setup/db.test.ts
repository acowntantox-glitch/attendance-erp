import { afterEach, describe, expect, it, vi } from "vitest";
import { isDatabaseAvailable } from "./db";

const PASSWORD = "leak-me-not-P4ss";
const NEON_URL = `postgresql://app_user:${PASSWORD}@ep-wild-glade-abc123-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;

/**
 * `isDatabaseAvailable()` is the first call of every DB-backed suite, before any fixture. It must
 * refuse a production-like database BEFORE opening a connection — proven here by never needing a
 * reachable database: a refusal is a synchronous-looking throw, and a local URL is merely reported
 * unavailable (or available), never refused.
 */
describe("isDatabaseAvailable production guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a production-like remote database without ever connecting, and leaks no credentials", async () => {
    vi.stubEnv("DATABASE_URL", NEON_URL);
    vi.stubEnv("TEST_DATABASE_ALLOWED_HOST", "");
    const started = Date.now();
    let message = "";
    try {
      await isDatabaseAvailable();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Refusing to run integration tests against a production database/);
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain("app_user");
    expect(message).not.toContain("postgresql://");
    // A connection attempt to that host would take far longer than a pure guard check.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("rejects a malformed DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", `not-a-url-${PASSWORD}`);
    await expect(isDatabaseAvailable()).rejects.toThrow(/Refusing to run integration tests/);
  });

  it("does not refuse a local database (it is just reported unavailable if nothing is listening)", async () => {
    // Port 1 is never a Postgres server; the point is only that the guard lets a local host through.
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:1/attendance_erp_test");
    await expect(isDatabaseAvailable()).resolves.toBe(false);
  });

  it("returns false (skip) when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(isDatabaseAvailable()).resolves.toBe(false);
  });
});
