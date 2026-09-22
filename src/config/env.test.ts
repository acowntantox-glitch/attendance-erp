import { describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: "a".repeat(32),
  APP_URL: "http://localhost:3000",
  NODE_ENV: "test",
};

async function loadEnvModule() {
  vi.resetModules();
  return import("./env");
}

describe("env config", () => {
  it("loads successfully with a valid environment", async () => {
    vi.stubEnv("DATABASE_URL", VALID_ENV.DATABASE_URL);
    vi.stubEnv("SESSION_SECRET", VALID_ENV.SESSION_SECRET);
    vi.stubEnv("APP_URL", VALID_ENV.APP_URL);
    vi.stubEnv("NODE_ENV", VALID_ENV.NODE_ENV);

    const mod = await loadEnvModule();
    expect(mod.env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(mod.isTest).toBe(true);

    vi.unstubAllEnvs();
  });

  it("throws when SESSION_SECRET is too short", async () => {
    vi.stubEnv("DATABASE_URL", VALID_ENV.DATABASE_URL);
    vi.stubEnv("SESSION_SECRET", "too-short");
    vi.stubEnv("APP_URL", VALID_ENV.APP_URL);
    vi.stubEnv("NODE_ENV", VALID_ENV.NODE_ENV);

    await expect(loadEnvModule()).rejects.toThrow(/SESSION_SECRET/);

    vi.unstubAllEnvs();
  });

  it("throws when DATABASE_URL is missing", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    vi.stubEnv("SESSION_SECRET", VALID_ENV.SESSION_SECRET);
    vi.stubEnv("APP_URL", VALID_ENV.APP_URL);

    await expect(loadEnvModule()).rejects.toThrow();

    vi.unstubAllEnvs();
    if (original !== undefined) process.env.DATABASE_URL = original;
  });
});
