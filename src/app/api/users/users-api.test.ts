import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isDatabaseAvailable } from "../../../tests/setup/db";
import { cleanup, clearRateLimitsFor, createCompany, createUser, NEW_PASSWORD, PASSWORD, type FixtureUser } from "../../../domains/auth/__tests__/fixtures";
import { loginEmailRule, loginIpRule } from "../../../domains/auth/rate-limit.service";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// A tiny in-memory cookie jar standing in for Next's request cookies, so the REAL route handlers,
// session lookup and request-context resolution run end to end.
const jar = vi.hoisted(() => ({ token: undefined as string | undefined, headers: {} as Record<string, string>, cookieName: "session_token" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === jar.cookieName && jar.token ? { value: jar.token } : undefined),
    set: (name: string, value: string) => {
      if (name === jar.cookieName) jar.token = value;
    },
    delete: (name: string) => {
      if (name === jar.cookieName) jar.token = undefined;
    },
  }),
  headers: async () => ({ get: (name: string) => jar.headers[name.toLowerCase()] ?? null }),
}));

const available = await isDatabaseAvailable();

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(!available)("user-management & password API (HTTP boundary)", () => {
  let pool: typeof import("@/db/client").pool;
  let session: typeof import("@/lib/auth/session");
  let usersRoute: typeof import("./route");
  let statusRoute: typeof import("./[id]/status/route");
  let resetRoute: typeof import("./[id]/reset-password/route");
  let changeRoute: typeof import("../auth/change-password/route");
  let loginRoute: typeof import("../auth/login/route");
  let meRoute: typeof import("../auth/me/route");

  let companyA: string;
  let companyB: string;
  let adminA: FixtureUser;
  let hrManagerA: FixtureUser;
  let employeeA: FixtureUser;
  let employeeA2: FixtureUser;
  let adminB: FixtureUser;
  let employeeB: FixtureUser;
  const all: FixtureUser[] = [];
  const rateKeys: string[] = [];

  const make = async (memberships: Parameters<typeof createUser>[0], options?: Parameters<typeof createUser>[1]) => {
    const user = await createUser(memberships, options);
    all.push(user);
    rateKeys.push(loginEmailRule(user.email).key);
    return user;
  };
  const signInAs = async (user: FixtureUser, companyId: string) => {
    jar.token = (await session.createSession(user.id, companyId)).token;
  };
  const errorOf = async (response: Response) => (await response.json()).error;

  beforeAll(async () => {
    ({ pool } = await import("@/db/client"));
    session = await import("@/lib/auth/session");
    jar.cookieName = (await import("@/lib/auth/constants")).SESSION_COOKIE_NAME;
    usersRoute = await import("./route");
    statusRoute = await import("./[id]/status/route");
    resetRoute = await import("./[id]/reset-password/route");
    changeRoute = await import("../auth/change-password/route");
    loginRoute = await import("../auth/login/route");
    meRoute = await import("../auth/me/route");

    companyA = await createCompany("ApiA");
    companyB = await createCompany("ApiB");
    adminA = await make([{ companyId: companyA, role: "COMPANY_ADMIN" }]);
    hrManagerA = await make([{ companyId: companyA, role: "HR_MANAGER" }]);
    employeeA = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
    employeeA2 = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
    adminB = await make([{ companyId: companyB, role: "COMPANY_ADMIN" }]);
    employeeB = await make([{ companyId: companyB, role: "EMPLOYEE" }]);
  });

  beforeEach(() => {
    jar.token = undefined;
    jar.headers = {};
  });

  afterAll(async () => {
    await clearRateLimitsFor(...rateKeys, loginIpRule("198.51.100.77").key);
    await cleanup([companyA, companyB], all.map((user) => user.id));
    await pool.end();
  });

  describe("authentication and authorization", () => {
    it("401 without a session", async () => {
      expect((await usersRoute.GET()).status).toBe(401);
      expect((await statusRoute.PATCH(json("PATCH", { active: false }), idParams(employeeA.id))).status).toBe(401);
      expect((await resetRoute.POST(json("POST"), idParams(employeeA.id))).status).toBe(401);
      expect((await changeRoute.POST(json("POST", {}))).status).toBe(401);
    });

    it.each([
      ["EMPLOYEE", () => employeeA],
      ["HR_MANAGER", () => hrManagerA],
    ])("403 for %s on every user-management endpoint, and nothing changes", async (_role, who) => {
      await signInAs(who(), companyA);
      const list = await usersRoute.GET();
      expect(list.status).toBe(403);
      expect((await errorOf(list)).code).toBe("FORBIDDEN");
      expect((await statusRoute.PATCH(json("PATCH", { active: false }), idParams(employeeA2.id))).status).toBe(403);
      expect((await resetRoute.POST(json("POST"), idParams(employeeA2.id))).status).toBe(403);
    });

    it("an administrator gets a company-scoped list with no hashes or tokens", async () => {
      await signInAs(adminA, companyA);
      const response = await usersRoute.GET();
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toMatch(/argon2|passwordHash|password_hash|sessionToken/i);
      const ids = (JSON.parse(text).data as { userId: string }[]).map((user) => user.userId);
      expect(ids).toContain(employeeA.id);
      expect(ids).not.toContain(employeeB.id);
    });
  });

  describe("tenant isolation over HTTP", () => {
    it("Company A's admin gets 404 for Company B's users on status and reset, and B's user is untouched", async () => {
      const bSession = await session.createSession(employeeB.id, companyB);
      await signInAs(adminA, companyA);

      const status = await statusRoute.PATCH(json("PATCH", { active: false }), idParams(employeeB.id));
      const reset = await resetRoute.POST(json("POST"), idParams(employeeB.id));
      expect(status.status).toBe(404);
      expect(reset.status).toBe(404);
      expect(await session.validateSessionToken(bSession.token)).not.toBeNull();
    });
  });

  describe("tenant isolation over HTTP (list)", () => {
    it("Company B's administrator lists only Company B, and cannot act on Company A's users", async () => {
      await signInAs(adminB, companyB);
      const list = await usersRoute.GET();
      expect(list.status).toBe(200);
      const ids = ((await list.json()).data as { userId: string }[]).map((user) => user.userId);
      expect(ids).toContain(employeeB.id);
      expect(ids).not.toContain(employeeA.id);
      expect(ids).not.toContain(adminA.id);

      expect((await statusRoute.PATCH(json("PATCH", { active: false }), idParams(employeeA.id))).status).toBe(404);
      expect((await resetRoute.POST(json("POST"), idParams(employeeA.id))).status).toBe(404);
    });
  });

  describe("input validation", () => {
    it("400 for a non-UUID id or a malformed body", async () => {
      await signInAs(adminA, companyA);
      expect((await statusRoute.PATCH(json("PATCH", { active: false }), idParams("not-a-uuid"))).status).toBe(400);
      expect((await resetRoute.POST(json("POST"), idParams("not-a-uuid"))).status).toBe(400);
      expect((await statusRoute.PATCH(json("PATCH", { active: "yes" }), idParams(employeeA2.id))).status).toBe(400);
      expect((await statusRoute.PATCH(json("PATCH", {}), idParams(employeeA2.id))).status).toBe(400);
    });
  });

  describe("deactivation over HTTP", () => {
    it("an existing session of a deactivated user can no longer reach protected resources", async () => {
      const target = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      await signInAs(target, companyA);
      expect((await meRoute.GET()).status).toBe(200);
      const targetToken = jar.token!;

      await signInAs(adminA, companyA);
      const response = await statusRoute.PATCH(json("PATCH", { active: false }), idParams(target.id));
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ userId: target.id, isActive: false, changed: true });

      jar.token = targetToken;
      expect((await meRoute.GET()).status).toBe(401);
    });
  });

  describe("admin reset and forced password change over HTTP", () => {
    it("returns the temporary password once (no-store), then confines the user to the change-password flow", async () => {
      const target = await make([{ companyId: companyA, role: "MANAGER" }]);
      const oldSession = (await session.createSession(target.id, companyA)).token;

      await signInAs(adminA, companyA);
      const reset = await resetRoute.POST(json("POST"), idParams(target.id));
      expect(reset.status).toBe(200);
      expect(reset.headers.get("cache-control")).toBe("no-store");
      const { temporaryPassword } = (await reset.json()).data as { temporaryPassword: string };
      expect(temporaryPassword).toBeTruthy();

      // Old session revoked; old password rejected.
      jar.token = oldSession;
      expect((await meRoute.GET()).status).toBe(401);
      jar.token = undefined;
      expect((await loginRoute.POST(json("POST", { email: target.email, password: PASSWORD }))).status).toBe(401);

      // Signing in with the temporary password works but flags the forced change...
      const login = await loginRoute.POST(json("POST", { email: target.email, password: temporaryPassword }));
      expect(login.status).toBe(200);
      expect((await login.json()).data.mustChangePassword).toBe(true);
      expect(jar.token).toBeTruthy();

      // ...and the account can then reach nothing else: every guarded route says so.
      const me = await meRoute.GET();
      expect(me.status).toBe(403);
      expect((await errorOf(me)).code).toBe("PASSWORD_CHANGE_REQUIRED");
      expect((await usersRoute.GET()).status).toBe(403);

      // The change-password route is the one thing that works. A wrong confirmation is a 400.
      const mismatch = await changeRoute.POST(json("POST", { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD, confirmPassword: "different-password-1" }));
      expect(mismatch.status).toBe(400);
      const done = await changeRoute.POST(json("POST", { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }));
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ data: { success: true, reauthenticate: true } });
      expect(jar.token).toBeUndefined(); // cookie cleared; every session revoked

      // Afterwards the new password works and there is no restriction any more.
      const relogin = await loginRoute.POST(json("POST", { email: target.email, password: NEW_PASSWORD }));
      expect(relogin.status).toBe(200);
      expect((await relogin.json()).data.mustChangePassword).toBe(false);
      expect((await meRoute.GET()).status).toBe(200);
    });
  });

  describe("change password over HTTP", () => {
    it("400 for a wrong current password and for a weak new password; 200 and re-login for a valid change", async () => {
      const user = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      await signInAs(user, companyA);

      const wrong = await changeRoute.POST(json("POST", { currentPassword: "not-right-at-all", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }));
      expect(wrong.status).toBe(400);
      expect((await errorOf(wrong)).message).toBe("Current password is incorrect.");
      expect(jar.token).toBeTruthy(); // a failed attempt does not sign the user out

      const weak = await changeRoute.POST(json("POST", { currentPassword: PASSWORD, newPassword: "short", confirmPassword: "short" }));
      expect(weak.status).toBe(400);

      const ok = await changeRoute.POST(json("POST", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }));
      expect(ok.status).toBe(200);
      expect(jar.token).toBeUndefined();
      expect((await loginRoute.POST(json("POST", { email: user.email, password: NEW_PASSWORD }))).status).toBe(200);
    });
  });

  describe("login over HTTP", () => {
    it("returns a generic 401 for a deactivated account and for a wrong password alike", async () => {
      const inactive = await make([{ companyId: companyA, role: "EMPLOYEE" }], { status: "inactive" });
      const a = await loginRoute.POST(json("POST", { email: inactive.email, password: PASSWORD }));
      const b = await loginRoute.POST(json("POST", { email: employeeA2.email, password: "wrong-password-value" }));
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect((await errorOf(a)).message).toBe((await errorOf(b)).message);
    });

    it("answers 429 once an email is over the limit — and an attacker changing the forwarded IP does not help", async () => {
      const victim = await make([{ companyId: companyA, role: "EMPLOYEE" }]);
      for (let i = 0; i < 5; i++) {
        const response = await loginRoute.POST(json("POST", { email: victim.email, password: "wrong-guess-value" }, { "x-forwarded-for": `198.51.100.${10 + i}` }));
        expect(response.status).toBe(401);
      }
      const blocked = await loginRoute.POST(json("POST", { email: victim.email, password: PASSWORD }, { "x-forwarded-for": "198.51.100.99" }));
      expect(blocked.status).toBe(429);
      expect((await errorOf(blocked)).code).toBe("RATE_LIMITED");

      // Everyone else is unaffected.
      const other = await loginRoute.POST(json("POST", { email: employeeA.email, password: PASSWORD }, { "x-forwarded-for": "198.51.100.99" }));
      expect(other.status).toBe(200);
      for (let i = 0; i < 5; i++) rateKeys.push(loginIpRule(`198.51.100.${10 + i}`).key);
      rateKeys.push(loginIpRule("198.51.100.99").key);
    });
  });
});
