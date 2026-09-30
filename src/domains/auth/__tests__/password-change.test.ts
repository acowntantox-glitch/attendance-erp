import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";
import { passwordChangeRule } from "../rate-limit.service";
import { auditFor, cleanup, clearRateLimitsFor, createCompany, createUser, ctxFor, NEW_PASSWORD, PASSWORD, sessionCount, type FixtureUser } from "./fixtures";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const available = await isDatabaseAvailable();

describe.skipIf(!available)("self-service password change", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../password.service");
  let authService: typeof import("../service");
  let errors: typeof import("@/lib/errors");
  let session: typeof import("@/lib/auth/session");
  let passwordLib: typeof import("@/lib/auth/password");

  let companyId: string;
  const created: FixtureUser[] = [];

  const newUser = async (options?: Parameters<typeof createUser>[1]) => {
    const user = await createUser([{ companyId, role: "EMPLOYEE" }], options);
    created.push(user);
    return user;
  };
  const hashOf = async (userId: string) => (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]!.passwordHash;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../password.service");
    authService = await import("../service");
    errors = await import("@/lib/errors");
    session = await import("@/lib/auth/session");
    passwordLib = await import("@/lib/auth/password");
    companyId = await createCompany("PwChange");
  });

  afterAll(async () => {
    await clearRateLimitsFor(...created.map((user) => passwordChangeRule(user.id).key));
    await cleanup([companyId], created.map((user) => user.id));
    await pool.end();
  });

  it("changes the password: new hash (Argon2id) stored, new password works, old one does not", async () => {
    const user = await newUser();
    const before = await hashOf(user.id);

    const result = await svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(result).toBeUndefined(); // nothing about the hash is ever returned

    const after = await hashOf(user.id);
    expect(after).not.toBe(before);
    expect(after.startsWith("$argon2id$")).toBe(true);
    expect(after).not.toContain(NEW_PASSWORD);
    await expect(passwordLib.verifyPassword(after, NEW_PASSWORD)).resolves.toBe(true);

    await expect(authService.login(user.email, NEW_PASSWORD)).resolves.toBeDefined();
    await expect(authService.login(user.email, PASSWORD)).rejects.toBeInstanceOf((await import("../errors")).InvalidCredentialsError);
  });

  it("invalidates ALL existing sessions — including the caller's and any other device's", async () => {
    const user = await newUser();
    const a = await session.createSession(user.id, companyId);
    const b = await session.createSession(user.id, companyId);
    expect(await sessionCount(user.id)).toBe(2);
    expect(await session.validateSessionToken(a.token)).not.toBeNull();

    await svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(await sessionCount(user.id)).toBe(0);
    expect(await session.validateSessionToken(a.token)).toBeNull();
    expect(await session.validateSessionToken(b.token)).toBeNull();
  });

  it("rejects a wrong current password without changing anything, and reveals nothing about the hash", async () => {
    const user = await newUser();
    const s = await session.createSession(user.id, companyId);
    const before = await hashOf(user.id);

    const error = await svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: "not-my-password", newPassword: NEW_PASSWORD }).catch((e) => e);
    expect(error).toBeInstanceOf(errors.ValidationError);
    expect(error.message).toBe("Current password is incorrect.");
    expect(JSON.stringify(error)).not.toContain(before);

    expect(await hashOf(user.id)).toBe(before);
    expect(await session.validateSessionToken(s.token)).not.toBeNull(); // sessions untouched by a failed attempt
  });

  it.each([
    ["too short", "short"],
    ["a common password", "Password123"],
    ["the known dev seed password", "DevPassword123!"],
    ["whitespace only", "            "],
    ["over the maximum length", "x".repeat(200)],
  ])("rejects a weak new password (%s) without changing anything", async (_label, weak) => {
    const user = await newUser();
    const before = await hashOf(user.id);
    await expect(svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: weak })).rejects.toBeInstanceOf(errors.ValidationError);
    expect(await hashOf(user.id)).toBe(before);
  });

  it("rejects a new password equal to the user's own email", async () => {
    const user = await newUser();
    await expect(svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: user.email })).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });

  it("rejects a new password identical to the current one", async () => {
    const user = await newUser();
    const before = await hashOf(user.id);
    const error = await svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: PASSWORD }).catch((e) => e);
    expect(error).toBeInstanceOf(errors.BusinessRuleError);
    expect(error.message).toMatch(/different from your current password/);
    expect(await hashOf(user.id)).toBe(before);
  });

  it("clears the forced-change flag when the user sets their own password", async () => {
    const user = await newUser({ mustChangePassword: true });
    await svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    const row = (await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0]!;
    expect(row.mustChangePassword).toBe(false);
  });

  it("rate-limits guessing of the current password (5 wrong attempts, then even the right one is refused)", async () => {
    const user = await newUser();
    const ctx = ctxFor(user, companyId, "EMPLOYEE");
    for (let i = 0; i < 5; i++) await expect(svc.changeOwnPassword(ctx, { currentPassword: `wrong-guess-${i}`, newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(errors.ValidationError);
    const blocked = await svc.changeOwnPassword(ctx, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).catch((e) => e);
    expect(blocked).toBeInstanceOf(errors.TooManyRequestsError);
    expect(await hashOf(user.id)).not.toContain(NEW_PASSWORD);
  });

  it("refuses an account that is no longer active", async () => {
    const user = await newUser({ status: "inactive" });
    await expect(svc.changeOwnPassword(ctxFor(user, companyId, "EMPLOYEE"), { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(
      errors.AuthenticationError,
    );
  });

  it("serializes concurrent changes: exactly one wins, and the stored password is the winner's", async () => {
    const user = await newUser();
    const ctx = ctxFor(user, companyId, "EMPLOYEE");
    const [a, b] = await Promise.allSettled([
      svc.changeOwnPassword(ctx, { currentPassword: PASSWORD, newPassword: "FirstConcurrentPassword-1" }),
      svc.changeOwnPassword(ctx, { currentPassword: PASSWORD, newPassword: "SecondConcurrentPassword-2" }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);

    const winner = a.status === "fulfilled" ? "FirstConcurrentPassword-1" : "SecondConcurrentPassword-2";
    const loser = a.status === "fulfilled" ? "SecondConcurrentPassword-2" : "FirstConcurrentPassword-1";
    const stored = await hashOf(user.id);
    await expect(passwordLib.verifyPassword(stored, winner)).resolves.toBe(true);
    await expect(passwordLib.verifyPassword(stored, loser)).resolves.toBe(false);
  });

  it("audits the change with useful metadata and never records a password or hash", async () => {
    const user = await newUser();
    const ctx = ctxFor(user, companyId, "EMPLOYEE");
    await svc.changeOwnPassword(ctx, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    const [entry] = await auditFor("auth.password_changed", user.id);
    expect(entry).toBeDefined();
    expect(entry!.actorUserId).toBe(user.id);
    expect(entry!.companyId).toBe(companyId);
    expect(entry!.metadata).toMatchObject({ sessionsInvalidated: true });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("argon2");
  });
});
