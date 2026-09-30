import { describe, expect, it } from "vitest";
import { assertSafeDatabaseTarget, classifyDatabaseUrl, UnsafeDatabaseTargetError } from "./db-safety";

// Fake credentials used only to prove they never appear in output.
const PASSWORD = "s3cr3t-P@ss-do-not-leak";
const ENCODED = encodeURIComponent(PASSWORD);
const NEON = `postgresql://app_user:${ENCODED}@ep-wild-glade-abc123-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
const LOCAL = `postgresql://postgres:${ENCODED}@localhost:5432/attendance_erp_test`;

describe("classifyDatabaseUrl", () => {
  it("recognises the allowed local hosts, including IPv6 and the compose service name", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "postgres", "LOCALHOST"]) {
      const result = classifyDatabaseUrl(`postgresql://u:p@${host}:5432/db`);
      expect(result.kind).toBe("local");
    }
    expect(classifyDatabaseUrl("postgres://u:p@[::1]/db")).toEqual({ kind: "local", host: "::1" });
  });

  it("treats a Neon / cloud host as remote", () => {
    expect(classifyDatabaseUrl(NEON)).toEqual({ kind: "remote", host: "ep-wild-glade-abc123-pooler.c-3.ap-southeast-1.aws.neon.tech" });
  });

  it("decides on the parsed hostname, not on substrings: 'localhost' inside a remote URL does not make it local", () => {
    expect(classifyDatabaseUrl("postgresql://localhost:pw@evil.example.com/localhost").kind).toBe("remote");
    expect(classifyDatabaseUrl("postgresql://u:p@localhost.evil.example.com/db").kind).toBe("remote");
    expect(classifyDatabaseUrl("postgresql://u:p@evil.example.com/db?note=localhost").kind).toBe("remote");
    expect(classifyDatabaseUrl("postgresql://u:p@postgres.evil.example.com/db").kind).toBe("remote");
  });

  it("refuses a URL that overrides the host through a query parameter (the pg driver honours it over the authority)", () => {
    expect(classifyDatabaseUrl("postgresql://u:p@localhost/db?host=prod.example.com").kind).toBe("invalid");
    expect(classifyDatabaseUrl("postgresql://u:p@localhost/db?hostaddr=10.0.0.5").kind).toBe("invalid");
  });

  it("refuses an ambiguous URL with an unescaped '@' in the password", () => {
    expect(classifyDatabaseUrl("postgresql://u:pa@ss@localhost/db").kind).toBe("invalid");
  });

  it("handles missing, empty, malformed and non-postgres input safely", () => {
    for (const bad of [undefined, null, "", "   ", "not a url", "://", "http://localhost/db", "mysql://u:p@localhost/db", "postgresql://"]) {
      expect(classifyDatabaseUrl(bad as string).kind).toBe("invalid");
    }
  });
});

describe("assertSafeDatabaseTarget", () => {
  const base = { purpose: "integration tests" };

  it("allows a local database (developer machine and CI service)", () => {
    expect(assertSafeDatabaseTarget({ ...base, databaseUrl: LOCAL })).toEqual({ host: "localhost" });
    expect(assertSafeDatabaseTarget({ ...base, databaseUrl: "postgresql://postgres:postgres@localhost:5432/attendance_erp_test", nodeEnv: "test" })).toEqual({
      host: "localhost",
    });
    expect(assertSafeDatabaseTarget({ ...base, databaseUrl: "postgresql://u:p@postgres:5432/db" })).toEqual({ host: "postgres" });
  });

  it("refuses the production-like Neon host with the documented message", () => {
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: NEON })).toThrow(UnsafeDatabaseTargetError);
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: NEON })).toThrow(/Refusing to run integration tests against a production database/);
  });

  it("refuses any unknown remote host by default (fail closed)", () => {
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: "postgresql://u:p@db.example.com/x" })).toThrow(/Refusing/);
  });

  it("allows a remote host only when the override names that EXACT hostname", () => {
    const host = "ep-test-branch-xyz.ap-southeast-1.aws.neon.tech";
    const url = `postgresql://u:p@${host}/testdb`;
    expect(assertSafeDatabaseTarget({ ...base, databaseUrl: url, allowedRemoteHost: host })).toEqual({ host });
    expect(assertSafeDatabaseTarget({ ...base, databaseUrl: url, allowedRemoteHost: host.toUpperCase() })).toEqual({ host });
    // A different host, a partial host, or a blanket value never bypasses the guard.
    for (const wrong of ["ep-other.neon.tech", "neon.tech", "*", "true", "1", "", undefined]) {
      expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: url, allowedRemoteHost: wrong })).toThrow(/Refusing/);
    }
  });

  it("refuses NODE_ENV=production for seed/tests even when the host is local", () => {
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: LOCAL, nodeEnv: "production", refuseProductionNodeEnv: true })).toThrow(/NODE_ENV is "production"/);
  });

  it("does NOT refuse NODE_ENV=production when not asked to (migrations run in production)", () => {
    expect(assertSafeDatabaseTarget({ purpose: "migration", databaseUrl: LOCAL, nodeEnv: "production" })).toEqual({ host: "localhost" });
  });

  it("does not rely on NODE_ENV alone: a production DB with NODE_ENV=development is still refused", () => {
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: NEON, nodeEnv: "development", refuseProductionNodeEnv: true })).toThrow(/Refusing/);
  });

  it("refuses a missing or malformed DATABASE_URL", () => {
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: undefined })).toThrow(/DATABASE_URL is not set/);
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: "garbage" })).toThrow(/not a valid URL/);
  });

  it("names the override variable in the hint but never echoes credentials, the password, or the full URL", () => {
    const attempts: (() => unknown)[] = [
      () => assertSafeDatabaseTarget({ ...base, databaseUrl: NEON, overrideVariable: "TEST_DATABASE_ALLOWED_HOST" }),
      () => assertSafeDatabaseTarget({ ...base, databaseUrl: `postgresql://u:${ENCODED}@db.example.com/x?host=other.example.com` }),
      () => assertSafeDatabaseTarget({ ...base, databaseUrl: `postgresql://u:${PASSWORD}@@db.example.com/x` }),
      () => assertSafeDatabaseTarget({ ...base, databaseUrl: `not a url ${PASSWORD}` }),
    ];
    for (const attempt of attempts) {
      let message = "";
      try {
        attempt();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(PASSWORD);
      expect(message).not.toContain(ENCODED);
      expect(message).not.toContain("postgresql://");
      expect(message).not.toContain("app_user");
    }
    expect(() => assertSafeDatabaseTarget({ ...base, databaseUrl: NEON, overrideVariable: "TEST_DATABASE_ALLOWED_HOST" })).toThrow(/TEST_DATABASE_ALLOWED_HOST/);
  });
});
