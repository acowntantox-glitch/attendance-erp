import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";
import { auditFor, cleanup, createCompany, createUser, ctxFor, NEW_PASSWORD, PASSWORD, sessionCount, type FixtureUser } from "./fixtures";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const available = await isDatabaseAvailable();

describe.skipIf(!available)("company-scoped user management", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let svc: typeof import("../user-management.service");
  let passwordSvc: typeof import("../password.service");
  let authService: typeof import("../service");
  let authErrors: typeof import("../errors");
  let errors: typeof import("@/lib/errors");
  let session: typeof import("@/lib/auth/session");
  let passwordLib: typeof import("@/lib/auth/password");

  let companyA: string;
  let companyB: string;
  let adminA: FixtureUser;
  let hrAdminA: FixtureUser;
  let hrManagerA: FixtureUser;
  let managerA: FixtureUser;
  let employeeA1: FixtureUser;
  let employeeA2: FixtureUser;
  let adminB: FixtureUser;
  let employeeB: FixtureUser;
  let shared: FixtureUser; // member of BOTH companies
  const all: FixtureUser[] = [];

  const make = async (memberships: Parameters<typeof createUser>[0]) => {
    const user = await createUser(memberships);
    all.push(user);
    return user;
  };
  const as = (user: FixtureUser, company: string, role: Parameters<typeof ctxFor>[2]) => ctxFor(user, company, role);
  const admin = () => as(adminA, companyA, "COMPANY_ADMIN");
  const membership = async (userId: string, companyId: string) =>
    (await db.select().from(schema.companyMemberships).where(and(eq(schema.companyMemberships.userId, userId), eq(schema.companyMemberships.companyId, companyId))))[0]!;
  const hashOf = async (userId: string) => (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]!.passwordHash;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    svc = await import("../user-management.service");
    passwordSvc = await import("../password.service");
    authService = await import("../service");
    authErrors = await import("../errors");
    errors = await import("@/lib/errors");
    session = await import("@/lib/auth/session");
    passwordLib = await import("@/lib/auth/password");

    companyA = await createCompany("UsersA");
    companyB = await createCompany("UsersB");
    adminA = await make([{ companyId: companyA, role: "COMPANY_ADMIN" }]);
    hrAdminA = await make([{ companyId: companyA, role: "HR_ADMIN" }]);
    hrManagerA = await make([{ companyId: companyA, role: "HR_MANAGER" }]);
    managerA = await make([{ companyId: companyA, role: "MANAGER" }]);
    employeeA1 = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
    employeeA2 = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
    adminB = await make([{ companyId: companyB, role: "COMPANY_ADMIN" }]);
    employeeB = await make([{ companyId: companyB, role: "EMPLOYEE" }]);
    shared = await make([
      { companyId: companyA, role: "EMPLOYEE" },
      { companyId: companyB, role: "EMPLOYEE" },
    ]);
  });

  afterAll(async () => {
    await cleanup([companyA, companyB], all.map((user) => user.id));
    await pool.end();
  });

  describe("listing", () => {
    it("returns only this company's members, with role/status, and never a hash or token", async () => {
      const list = await svc.listCompanyUsers(admin());
      const ids = list.map((user) => user.userId);
      expect(ids).toEqual(expect.arrayContaining([adminA.id, hrAdminA.id, hrManagerA.id, managerA.id, employeeA1.id, employeeA2.id, shared.id]));
      expect(ids).not.toContain(adminB.id);
      expect(ids).not.toContain(employeeB.id);

      const row = list.find((user) => user.userId === employeeA1.id)!;
      expect(row).toMatchObject({ email: employeeA1.email, role: "EMPLOYEE", membershipActive: true, accountDisabled: false, mustChangePassword: false });
      expect(row.createdAt).toBeInstanceOf(Date);

      const serialized = JSON.stringify(list);
      expect(serialized).not.toMatch(/argon2|passwordHash|password_hash|token/i);
      for (const user of list) expect(Object.keys(user)).not.toContain("passwordHash");
    });

    it("flags who the caller may manage (not themselves, not a higher role)", async () => {
      const asAdmin = await svc.listCompanyUsers(admin());
      expect(asAdmin.find((user) => user.userId === adminA.id)).toMatchObject({ isSelf: true, canManage: false });
      expect(asAdmin.find((user) => user.userId === hrAdminA.id)!.canManage).toBe(true);

      const asHrAdmin = await svc.listCompanyUsers(as(hrAdminA, companyA, "HR_ADMIN"));
      expect(asHrAdmin.find((user) => user.userId === adminA.id)!.canManage).toBe(false);
      expect(asHrAdmin.find((user) => user.userId === employeeA1.id)!.canManage).toBe(true);
    });

    it("another company's administrator sees a different, disjoint set", async () => {
      const list = await svc.listCompanyUsers(as(adminB, companyB, "COMPANY_ADMIN"));
      const ids = list.map((user) => user.userId);
      expect(ids).toEqual(expect.arrayContaining([adminB.id, employeeB.id, shared.id]));
      expect(ids).not.toContain(adminA.id);
      expect(ids).not.toContain(employeeA1.id);
    });
  });

  describe("authorization (service boundary)", () => {
    it.each([
      ["HR_MANAGER", () => as(hrManagerA, companyA, "HR_MANAGER")],
      ["MANAGER", () => as(managerA, companyA, "MANAGER")],
      ["EMPLOYEE", () => as(employeeA1, companyA, "EMPLOYEE")],
    ])("%s cannot list, deactivate or reset (403)", async (_role, ctx) => {
      await expect(svc.listCompanyUsers(ctx())).rejects.toBeInstanceOf(errors.AuthorizationError);
      await expect(svc.setUserActive(ctx(), employeeA2.id, false)).rejects.toBeInstanceOf(errors.AuthorizationError);
      await expect(svc.resetUserPassword(ctx(), employeeA2.id)).rejects.toBeInstanceOf(errors.AuthorizationError);
      expect((await membership(employeeA2.id, companyA)).isActive).toBe(true);
    });

    it("HR_ADMIN may manage lower roles but NOT a COMPANY_ADMIN (no privilege escalation)", async () => {
      const hr = as(hrAdminA, companyA, "HR_ADMIN");
      const adminHashBefore = await hashOf(adminA.id);
      await expect(svc.setUserActive(hr, adminA.id, false)).rejects.toBeInstanceOf(errors.AuthorizationError);
      await expect(svc.resetUserPassword(hr, adminA.id)).rejects.toBeInstanceOf(errors.AuthorizationError);
      expect((await membership(adminA.id, companyA)).isActive).toBe(true);
      expect(await hashOf(adminA.id)).toBe(adminHashBefore);

      await expect(svc.setUserActive(hr, managerA.id, true)).resolves.toMatchObject({ changed: false });
    });

    it("nobody can act on their own account through the admin operations", async () => {
      await expect(svc.setUserActive(admin(), adminA.id, false)).rejects.toBeInstanceOf(errors.BusinessRuleError);
      await expect(svc.resetUserPassword(admin(), adminA.id)).rejects.toBeInstanceOf(errors.BusinessRuleError);
      expect((await membership(adminA.id, companyA)).isActive).toBe(true);
    });
  });

  describe("tenant isolation", () => {
    it("a Company A administrator cannot deactivate or reset a Company B user (404, nothing changes)", async () => {
      const hashBefore = await hashOf(employeeB.id);
      const s = await session.createSession(employeeB.id, companyB);

      await expect(svc.setUserActive(admin(), employeeB.id, false)).rejects.toBeInstanceOf(errors.NotFoundError);
      await expect(svc.resetUserPassword(admin(), employeeB.id)).rejects.toBeInstanceOf(errors.NotFoundError);

      expect((await membership(employeeB.id, companyB)).isActive).toBe(true);
      expect(await hashOf(employeeB.id)).toBe(hashBefore);
      expect(await session.validateSessionToken(s.token)).not.toBeNull();
    });

    it("an unknown user id is indistinguishable from another tenant's user", async () => {
      const unknown = "00000000-0000-4000-8000-000000000000";
      const foreign = await svc.setUserActive(admin(), employeeB.id, false).catch((e) => e);
      const missing = await svc.setUserActive(admin(), unknown, false).catch((e) => e);
      expect(missing).toBeInstanceOf(errors.NotFoundError);
      expect(foreign.message).toBe(missing.message);
    });

    it("deactivating a user in one company does not cut their access to another company", async () => {
      const inB = await session.createSession(shared.id, companyB);
      const inA = await session.createSession(shared.id, companyA);

      await svc.setUserActive(admin(), shared.id, false);

      expect((await membership(shared.id, companyA)).isActive).toBe(false);
      expect((await membership(shared.id, companyB)).isActive).toBe(true);
      expect(await session.validateSessionToken(inA.token)).toBeNull(); // company A session revoked
      expect(await session.validateSessionToken(inB.token)).not.toBeNull(); // company B session survives
      await expect(authService.login(shared.email, PASSWORD)).resolves.toMatchObject({ company: { companyId: companyB } });

      await svc.setUserActive(admin(), shared.id, true);
    });
  });

  describe("activate / deactivate", () => {
    it("deactivation revokes sessions immediately, blocks new logins, keeps history, and is reversible", async () => {
      const s1 = await session.createSession(employeeA1.id, companyA);
      const s2 = await session.createSession(employeeA1.id, companyA);

      const result = await svc.setUserActive(admin(), employeeA1.id, false);
      expect(result).toEqual({ userId: employeeA1.id, isActive: false, changed: true });

      expect(await sessionCount(employeeA1.id)).toBe(0);
      expect(await session.validateSessionToken(s1.token)).toBeNull();
      expect(await session.validateSessionToken(s2.token)).toBeNull();
      await expect(authService.login(employeeA1.email, PASSWORD)).rejects.toBeInstanceOf(authErrors.NoCompanyContextError);

      // The user row itself (and so history/audit that reference it) is untouched.
      expect((await db.select().from(schema.users).where(eq(schema.users.id, employeeA1.id))).length).toBe(1);

      const [deactivated] = await auditFor("user.deactivated", employeeA1.id);
      expect(deactivated).toMatchObject({ actorUserId: adminA.id, companyId: companyA });
      expect(deactivated!.metadata).toMatchObject({ targetRole: "EMPLOYEE", sessionsInvalidated: true });

      await expect(svc.setUserActive(admin(), employeeA1.id, true)).resolves.toMatchObject({ changed: true, isActive: true });
      await expect(authService.login(employeeA1.email, PASSWORD)).resolves.toBeDefined();
      expect((await auditFor("user.activated", employeeA1.id)).length).toBe(1);
    });

    it("even a session row that somehow survives cannot authorize once the membership is inactive", async () => {
      const stale = await session.createSession(employeeA2.id, companyA);
      // Bypass the service: flip only the flag, leaving the session row in place.
      await db.update(schema.companyMemberships).set({ isActive: false }).where(and(eq(schema.companyMemberships.userId, employeeA2.id), eq(schema.companyMemberships.companyId, companyA)));

      const validated = await session.validateSessionToken(stale.token);
      expect(validated?.company).toBeNull(); // no company context => getRequestContext() rejects it

      await db.update(schema.companyMemberships).set({ isActive: true }).where(and(eq(schema.companyMemberships.userId, employeeA2.id), eq(schema.companyMemberships.companyId, companyA)));
    });

    it("repeating the current state is a no-op (no extra audit entry)", async () => {
      const before = (await auditFor("user.deactivated", employeeA2.id)).length;
      await svc.setUserActive(admin(), employeeA2.id, false);
      await expect(svc.setUserActive(admin(), employeeA2.id, false)).resolves.toMatchObject({ changed: false });
      expect((await auditFor("user.deactivated", employeeA2.id)).length).toBe(before + 1);
      await svc.setUserActive(admin(), employeeA2.id, true);
    });

    it("concurrent deactivation of the same user is safe (both settle, state is inactive, one audit entry)", async () => {
      const target = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      const results = await Promise.all([svc.setUserActive(admin(), target.id, false), svc.setUserActive(admin(), target.id, false)]);
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect((await membership(target.id, companyA)).isActive).toBe(false);
      expect((await auditFor("user.deactivated", target.id)).length).toBe(1);
    });
  });

  describe("admin password reset", () => {
    it("issues a one-time temporary password, revokes every session, forces a change, and old credentials stop working", async () => {
      const target = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      const s = await session.createSession(target.id, companyA);
      const oldHash = await hashOf(target.id);

      const result = await svc.resetUserPassword(admin(), target.id);
      expect(Object.keys(result).sort()).toEqual(["temporaryPassword", "userId"]);
      expect(result.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);

      // Only an Argon2id hash is stored — never the temporary password itself.
      const stored = await hashOf(target.id);
      expect(stored).not.toBe(oldHash);
      expect(stored.startsWith("$argon2id$")).toBe(true);
      expect(stored).not.toContain(result.temporaryPassword);
      expect(await session.validateSessionToken(s.token)).toBeNull();
      expect(await sessionCount(target.id)).toBe(0);

      await expect(authService.login(target.email, PASSWORD)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
      const login = await authService.login(target.email, result.temporaryPassword);
      expect(login.user.mustChangePassword).toBe(true);
      expect(JSON.stringify(login)).not.toMatch(/passwordHash|argon2/);

      // The forced flag is what blocks everything but the change-password flow.
      const validated = await session.validateSessionToken(login.token);
      expect(validated?.user.mustChangePassword).toBe(true);

      // The user completes the flow by choosing their own password, which clears the flag.
      await passwordSvc.changeOwnPassword(ctxFor(target, companyA, "EMPLOYEE"), { currentPassword: result.temporaryPassword, newPassword: NEW_PASSWORD });
      const row = (await db.select().from(schema.users).where(eq(schema.users.id, target.id)))[0]!;
      expect(row.mustChangePassword).toBe(false);
      await expect(passwordLib.verifyPassword(row.passwordHash, NEW_PASSWORD)).resolves.toBe(true);
    });

    it("audits the reset (actor, target, company) without the temporary password or any hash", async () => {
      const target = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      const { temporaryPassword } = await svc.resetUserPassword(admin(), target.id);

      const [entry] = await auditFor("auth.password_reset", target.id);
      expect(entry).toMatchObject({ actorUserId: adminA.id, companyId: companyA, entityType: "user" });
      expect(entry!.metadata).toMatchObject({ targetRole: "EMPLOYEE", sessionsInvalidated: true, mustChangePassword: true });
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(temporaryPassword);
      expect(serialized).not.toContain("argon2");
    });

    it("produces a different password on every reset", async () => {
      const target = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      const first = await svc.resetUserPassword(admin(), target.id);
      const second = await svc.resetUserPassword(admin(), target.id);
      expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
      await expect(authService.login(target.email, first.temporaryPassword)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
      await expect(authService.login(target.email, second.temporaryPassword)).resolves.toBeDefined();
    });

    it("refuses to reset an account that also belongs to another company (its password is global)", async () => {
      const hashBefore = await hashOf(shared.id);
      const s = await session.createSession(shared.id, companyB);
      await expect(svc.resetUserPassword(admin(), shared.id)).rejects.toBeInstanceOf(errors.ConflictError);
      expect(await hashOf(shared.id)).toBe(hashBefore);
      expect(await session.validateSessionToken(s.token)).not.toBeNull();
    });

    it("a COMPANY_ADMIN may reset an HR_ADMIN", async () => {
      await expect(svc.resetUserPassword(admin(), hrAdminA.id)).resolves.toMatchObject({ userId: hrAdminA.id });
    });
  });
});
