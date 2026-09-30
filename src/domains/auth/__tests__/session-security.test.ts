import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";
import { cleanup, createCompany, createUser, NEW_PASSWORD, PASSWORD, sessionCount, type FixtureUser } from "./fixtures";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const available = await isDatabaseAvailable();

describe.skipIf(!available)("session and audit security", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let authService: typeof import("../service");
  let authErrors: typeof import("../errors");
  let repository: typeof import("../repository");
  let passwordLib: typeof import("@/lib/auth/password");
  let auditService: typeof import("@/domains/audit/service");

  let companyId: string;
  const users: FixtureUser[] = [];

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    authService = await import("../service");
    authErrors = await import("../errors");
    repository = await import("../repository");
    passwordLib = await import("@/lib/auth/password");
    auditService = await import("@/domains/audit/service");
    companyId = await createCompany("SessionSec");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanup([companyId], users.map((user) => user.id));
    await pool.end();
  });

  it("a login that verified the OLD password cannot end up with a live session after the password was reset", async () => {
    const user = await createUser([{ companyId, role: "EMPLOYEE" }]);
    users.push(user);

    // Snapshot the row exactly as a login that started before the reset would have read it...
    const stale = (await repository.userRepository.findByEmail(user.email))!;
    // ...then the reset commits (new hash) before that login gets to create its session.
    await db.update(schema.users).set({ passwordHash: await passwordLib.hashPassword(NEW_PASSWORD) }).where(eq(schema.users.id, user.id));
    vi.spyOn(repository.userRepository, "findByEmail").mockResolvedValue(stale);

    await expect(authService.login(user.email, PASSWORD)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
    expect(await sessionCount(user.id)).toBe(0); // the just-created session was discarded
  });

  it("the same guard rejects a login racing with the account being disabled", async () => {
    const user = await createUser([{ companyId, role: "EMPLOYEE" }]);
    users.push(user);
    const stale = (await repository.userRepository.findByEmail(user.email))!;
    await db.update(schema.users).set({ status: "inactive" }).where(eq(schema.users.id, user.id));
    vi.spyOn(repository.userRepository, "findByEmail").mockResolvedValue(stale);

    await expect(authService.login(user.email, PASSWORD)).rejects.toBeInstanceOf(authErrors.InvalidCredentialsError);
    expect(await sessionCount(user.id)).toBe(0);
  });

  it("an ordinary login is unaffected by the guard", async () => {
    const user = await createUser([{ companyId, role: "EMPLOYEE" }]);
    users.push(user);
    await expect(authService.login(user.email, PASSWORD)).resolves.toMatchObject({ user: { email: user.email } });
    expect(await sessionCount(user.id)).toBe(1);
  });

  it("the audit log redacts every password-like field, at any depth, in old/new data", async () => {
    const user = await createUser([{ companyId, role: "EMPLOYEE" }]);
    users.push(user);
    await auditService.recordAuditLog(
      { companyId, requestId: "audit-redaction-test", userId: user.id },
      {
        action: "test.redaction",
        entityType: "user",
        entityId: user.id,
        oldData: { passwordHash: "$argon2id$secret-hash", nested: { currentPassword: "old-secret-1" } },
        newData: { newPassword: "new-secret-2", confirmPassword: "new-secret-2", temporaryPassword: "Temp-Secret-3", password: "plain-secret-4", keep: "visible" },
      },
    );

    const [row] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, user.id));
    const serialized = JSON.stringify(row);
    for (const secret of ["argon2id$secret-hash", "old-secret-1", "new-secret-2", "Temp-Secret-3", "plain-secret-4"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("visible");
    expect(serialized).toContain("[REDACTED]");
  });
});
