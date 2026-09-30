import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";
import { getClientIp, loginEmailRule, loginIpRule, passwordChangeRule, RATE_LIMIT_WINDOW_SECONDS } from "../rate-limit.service";
import { auditFor, cleanup, clearRateLimitsFor, createCompany, createUser, PASSWORD, type FixtureUser } from "./fixtures";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe("rate-limit keys and client IP (pure)", () => {
  it("keys are hashes: no plaintext email, IP or user id appears in them", () => {
    const rules = [loginEmailRule("Person@Example.com"), loginIpRule("203.0.113.9"), passwordChangeRule("user-id-123")];
    for (const rule of rules) {
      expect(rule.key).toMatch(/^(login-email|login-ip|pw-change):[0-9a-f]{64}$/);
      expect(rule.key).not.toContain("example");
      expect(rule.key).not.toContain("203.0.113.9");
      expect(rule.key).not.toContain("user-id-123");
    }
  });

  it("the email key is the normalized email: casing and surrounding whitespace do not create a new counter", () => {
    const base = loginEmailRule("person@example.com").key;
    expect(loginEmailRule("PERSON@Example.COM").key).toBe(base);
    expect(loginEmailRule("  person@example.com \n").key).toBe(base);
    expect(loginEmailRule("other@example.com").key).not.toBe(base);
  });

  it("uses the first x-forwarded-for hop, falls back to x-real-ip, and rejects non-IP values", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(getClientIp(headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(getClientIp(headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(getClientIp(headers({ "x-forwarded-for": "not-an-ip" }))).toBeNull();
    expect(getClientIp(headers({}))).toBeNull();
  });
});

const available = await isDatabaseAvailable();

describe.skipIf(!available)("login rate limiting (database)", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let authService: typeof import("../service");
  let errors: typeof import("@/lib/errors");
  let authErrors: typeof import("../errors");

  let companyId: string;
  let victim: FixtureUser;
  let bystander: FixtureUser;
  let ipCounter = 0;
  const freshIp = () => `10.99.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  const ipsUsed: string[] = [];
  const emailsUsed = new Set<string>();

  const wrong = (email: string, ip?: string) => {
    emailsUsed.add(email);
    if (ip) ipsUsed.push(ip);
    return authService.login(email, "definitely-the-wrong-password", undefined, ip ?? null);
  };
  const correct = (user: FixtureUser, ip?: string) => {
    emailsUsed.add(user.email);
    if (ip) ipsUsed.push(ip);
    return authService.login(user.email, PASSWORD, undefined, ip ?? null);
  };
  const emailKeyRow = async (email: string) =>
    (await db.select().from(schema.authRateLimits).where(eq(schema.authRateLimits.key, loginEmailRule(email).key)))[0];

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    authService = await import("../service");
    errors = await import("@/lib/errors");
    authErrors = await import("../errors");
    companyId = await createCompany("RateLimit");
    victim = await createUser([{ companyId, role: "EMPLOYEE" }]);
    bystander = await createUser([{ companyId, role: "EMPLOYEE" }]);
  });

  beforeEach(async () => {
    await clearRateLimitsFor(loginEmailRule(victim.email).key, loginEmailRule(bystander.email).key);
  });

  afterAll(async () => {
    await clearRateLimitsFor(...[...emailsUsed].map((email) => loginEmailRule(email).key), ...ipsUsed.map((ip) => loginIpRule(ip).key));
    await cleanup([companyId], [victim.id, bystander.id]);
    await pool.end();
  });

  it("blocks the 6th attempt for an email after 5 failures — even with the CORRECT password — with a generic 429", async () => {
    for (let i = 0; i < 5; i++) await expect(wrong(victim.email)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);

    const blocked = await correct(victim).catch((error) => error);
    expect(blocked).toBeInstanceOf(errors.TooManyRequestsError);
    expect(blocked.httpStatus).toBe(429);
    expect(blocked.code).toBe("RATE_LIMITED");
    expect(blocked.message).not.toContain(victim.email);
  });

  it("does not reveal which emails exist: a non-existent email is limited with the same error", async () => {
    const ghost = `ghost-${Date.now()}@test.local`;
    for (let i = 0; i < 5; i++) await expect(wrong(ghost)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
    const ghostBlocked = await wrong(ghost).catch((error) => error);

    for (let i = 0; i < 5; i++) await expect(wrong(victim.email)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
    const realBlocked = await wrong(victim.email).catch((error) => error);

    expect(ghostBlocked).toBeInstanceOf(errors.TooManyRequestsError);
    expect(realBlocked).toBeInstanceOf(errors.TooManyRequestsError);
    expect(ghostBlocked.message).toBe(realBlocked.message);
    await clearRateLimitsFor(loginEmailRule(ghost).key);
  });

  it("wrong password, unknown email and a disabled account all give the identical credentials error", async () => {
    const disabled = await createUser([{ companyId, role: "EMPLOYEE" }], { status: "inactive" });
    const a = await wrong(victim.email).catch((error) => error);
    const b = await wrong(`nobody-${Date.now()}@test.local`).catch((error) => error);
    const c = await authService.login(disabled.email, PASSWORD).catch((error) => error);
    emailsUsed.add(disabled.email);
    expect(a).toBeInstanceOf(authErrors.InvalidCredentialsError);
    expect(b).toBeInstanceOf(authErrors.InvalidCredentialsError);
    expect(c).toBeInstanceOf(authErrors.InvalidCredentialsError);
    expect(new Set([a.message, b.message, c.message]).size).toBe(1);
    await cleanup([], [disabled.id]);
  });

  it("does not block unrelated users", async () => {
    for (let i = 0; i < 6; i++) await wrong(victim.email).catch(() => undefined);
    await expect(correct(bystander)).resolves.toMatchObject({ user: { email: bystander.email } });
  });

  it("a successful login relaxes the per-account limit (counter cleared, a fresh allowance follows)", async () => {
    for (let i = 0; i < 3; i++) await wrong(victim.email).catch(() => undefined);
    expect((await emailKeyRow(victim.email))?.attempts).toBe(3);

    await expect(correct(victim)).resolves.toBeDefined();
    expect(await emailKeyRow(victim.email)).toBeUndefined();

    // A full new allowance: 5 more failures are tolerated before the block.
    for (let i = 0; i < 5; i++) await expect(wrong(victim.email)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
    await expect(wrong(victim.email)).rejects.toBeInstanceOf(errors.TooManyRequestsError);
  });

  it("cannot be bypassed by changing case, whitespace, source IP or the companyId field", async () => {
    const variants = [victim.email, victim.email.toUpperCase(), `  ${victim.email}  `, victim.email, victim.email.toUpperCase()];
    for (const [index, variant] of variants.entries()) {
      emailsUsed.add(variant);
      // Each attempt also comes from a different IP and names a different (bogus) company.
      const ip = freshIp();
      ipsUsed.push(ip);
      await expect(authService.login(variant, "definitely-the-wrong-password", index % 2 ? companyId : undefined, ip)).rejects.toBeInstanceOf(
        authErrors.InvalidCredentialsError,
      );
    }
    const ip = freshIp();
    ipsUsed.push(ip);
    await expect(authService.login(victim.email, PASSWORD, undefined, ip)).rejects.toBeInstanceOf(errors.TooManyRequestsError);
    expect((await emailKeyRow(victim.email))?.attempts).toBe(5);
  });

  it("limits a single IP spraying many emails (20 failures), without affecting other IPs", async () => {
    const attacker = freshIp();
    const innocent = freshIp();
    for (let i = 0; i < 20; i++) await expect(wrong(`spray-${Date.now()}-${i}@test.local`, attacker)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);

    await expect(wrong(`spray-fresh-${Date.now()}@test.local`, attacker)).rejects.toBeInstanceOf(errors.TooManyRequestsError);
    // Even a legitimate user is refused from the blocked IP...
    await expect(correct(bystander, attacker)).rejects.toBeInstanceOf(errors.TooManyRequestsError);
    // ...but the same user from another IP is fine.
    await expect(correct(bystander, innocent)).resolves.toBeDefined();
  });

  it("blocks are temporary: once the window has ended, sign-in works again", async () => {
    for (let i = 0; i < 5; i++) await wrong(victim.email).catch(() => undefined);
    await expect(correct(victim)).rejects.toBeInstanceOf(errors.TooManyRequestsError);

    // Age the counter past the window (the database clock is authoritative).
    await db
      .update(schema.authRateLimits)
      .set({ windowStart: sql`now() - make_interval(secs => ${RATE_LIMIT_WINDOW_SECONDS + 5})` })
      .where(eq(schema.authRateLimits.key, loginEmailRule(victim.email).key));

    await expect(correct(victim)).resolves.toBeDefined();
  });

  it("counts concurrent failures atomically (no lost increments)", async () => {
    await Promise.all(Array.from({ length: 4 }, () => wrong(victim.email).catch(() => undefined)));
    expect((await emailKeyRow(victim.email))?.attempts).toBe(4);
  });

  it("writes ONE audit event when a limit is first reached — none for later blocked attempts — and it holds no email or IP", async () => {
    const ip = freshIp();
    const before = (await auditFor("auth.login_rate_limited")).length;
    for (let i = 0; i < 5; i++) await wrong(victim.email, ip).catch(() => undefined);
    const afterLimit = await auditFor("auth.login_rate_limited");
    expect(afterLimit.length).toBe(before + 1);

    for (let i = 0; i < 3; i++) await wrong(victim.email, ip).catch(() => undefined); // blocked attempts
    expect((await auditFor("auth.login_rate_limited")).length).toBe(before + 1);

    const newest = afterLimit.at(-1)!;
    const serialized = JSON.stringify(newest);
    expect(serialized).not.toContain(victim.email);
    expect(serialized).not.toContain(ip);
    expect(newest.metadata).toMatchObject({ context: "login", limits: ["login-email"] });
  });

  it("keeps the table bounded: stale counters are deleted on the next failure", async () => {
    const staleKey = `login-email:${"0".repeat(63)}1`;
    await db.insert(schema.authRateLimits).values({ key: staleKey, attempts: 5, windowStart: sql`now() - interval '3 days'` });
    await wrong(victim.email).catch(() => undefined);
    const rows = await db.select().from(schema.authRateLimits).where(and(eq(schema.authRateLimits.key, staleKey)));
    expect(rows).toHaveLength(0);
  });
});
