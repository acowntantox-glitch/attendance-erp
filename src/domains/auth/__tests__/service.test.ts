import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

describe.skipIf(!available)("auth service login", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let authService: typeof import("../service");
  let InvalidCredentialsError: typeof import("../errors").InvalidCredentialsError;
  let hashPassword: typeof import("@/lib/auth/password").hashPassword;
  let validateSessionToken: typeof import("@/lib/auth/session").validateSessionToken;

  let companyId: string;
  let userEmail: string;
  const plainPassword = "CorrectHorseBatteryStaple1!";

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    authService = await import("../service");
    ({ InvalidCredentialsError } = await import("../errors"));
    ({ hashPassword } = await import("@/lib/auth/password"));
    ({ validateSessionToken } = await import("@/lib/auth/session"));

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "Auth Service Test Co", code: `AUTH_TEST_${Date.now()}` })
      .returning();
    companyId = company!.id;

    userEmail = `login-test-${Date.now()}@test.local`;
    const passwordHash = await hashPassword(plainPassword);
    const [user] = await db
      .insert(schema.users)
      .values({ email: userEmail, passwordHash, fullName: "Login Test User" })
      .returning();

    await db.insert(schema.companyMemberships).values({
      userId: user!.id,
      companyId,
      role: "COMPANY_ADMIN",
    });
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    await db.delete(schema.users).where(eq(schema.users.email, userEmail));
    await pool.end();
  });

  it("rejects an incorrect password", async () => {
    await expect(authService.login(userEmail, "WrongPassword")).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects an unknown email", async () => {
    await expect(authService.login("nobody@test.local", plainPassword)).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("logs in successfully and issues a valid, resolvable session", async () => {
    const result = await authService.login(userEmail, plainPassword);
    expect(result.company.companyId).toBe(companyId);
    expect(result.company.role).toBe("COMPANY_ADMIN");

    const session = await validateSessionToken(result.token);
    expect(session?.user.email).toBe(userEmail);
    expect(session?.company?.companyId).toBe(companyId);
  });

  it("logs out and invalidates the session", async () => {
    const result = await authService.login(userEmail, plainPassword);
    await authService.logout(result.token);
    const session = await validateSessionToken(result.token);
    expect(session).toBeNull();
  });
});
