/**
 * Shared fixtures for the DB-backed auth suites. Imports the database lazily so a suite that is
 * skipped (no test database) never opens a connection. Everything created here is unique per call
 * and removed by `cleanup`, and it only ever runs against the guarded local test database.
 */
import { eq, inArray } from "drizzle-orm";
import type { RequestContext } from "@/lib/auth/request-context";

export const PASSWORD = "CorrectHorseBatteryStaple1!";
export const NEW_PASSWORD = "AnotherLongPassphrase42";

type Role = "SUPER_ADMIN" | "COMPANY_ADMIN" | "HR_ADMIN" | "HR_MANAGER" | "MANAGER" | "EMPLOYEE";

let sharedHash: string | null = null;
let counter = 0;
const unique = () => `${Date.now()}-${++counter}-${Math.random().toString(36).slice(2, 6)}`;

export async function createCompany(label: string): Promise<string> {
  const { db } = await import("@/db/client");
  const { companies } = await import("@/db/schema");
  const [company] = await db.insert(companies).values({ name: `Auth ${label}`, code: `AUTH_${label}_${unique()}`.slice(0, 40) }).returning();
  return company!.id;
}

export type FixtureUser = { id: string; email: string; fullName: string };

export async function createUser(
  memberships: { companyId: string; role: Role; isActive?: boolean }[],
  options: { password?: string; status?: "active" | "inactive"; mustChangePassword?: boolean; fullName?: string } = {},
): Promise<FixtureUser> {
  const { db } = await import("@/db/client");
  const { users, companyMemberships } = await import("@/db/schema");
  const { hashPassword } = await import("@/lib/auth/password");

  // Argon2 is deliberately slow; every fixture user shares one hash unless a test needs its own.
  let passwordHash: string;
  if (options.password && options.password !== PASSWORD) passwordHash = await hashPassword(options.password);
  else passwordHash = sharedHash ??= await hashPassword(PASSWORD);

  const email = `auth-${unique()}@test.local`;
  const fullName = options.fullName ?? `Auth User ${unique()}`;
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, fullName, status: options.status ?? "active", mustChangePassword: options.mustChangePassword ?? false })
    .returning();
  for (const m of memberships) {
    await db.insert(companyMemberships).values({ userId: user!.id, companyId: m.companyId, role: m.role, isActive: m.isActive ?? true });
  }
  return { id: user!.id, email, fullName };
}

export function ctxFor(user: FixtureUser, companyId: string, role: Role): RequestContext {
  return { requestId: `auth-test-${unique()}`, userId: user.id, userEmail: user.email, companyId, role, employeeId: null };
}

export async function sessionCount(userId: string): Promise<number> {
  const { db } = await import("@/db/client");
  const { sessions } = await import("@/db/schema");
  return (await db.select().from(sessions).where(eq(sessions.userId, userId))).length;
}

export async function clearRateLimitsFor(...keys: string[]): Promise<void> {
  const { db } = await import("@/db/client");
  const { authRateLimits } = await import("@/db/schema");
  if (keys.length > 0) await db.delete(authRateLimits).where(inArray(authRateLimits.key, keys));
}

export async function auditFor(action: string, entityId?: string) {
  const { db } = await import("@/db/client");
  const { auditLogs } = await import("@/db/schema");
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, action));
  return entityId ? rows.filter((row) => row.entityId === entityId) : rows;
}

export async function cleanup(companyIds: string[], userIds: string[]): Promise<void> {
  const { db } = await import("@/db/client");
  const { companies, users, auditLogs } = await import("@/db/schema");
  if (userIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (companyIds.length > 0) await db.delete(companies).where(inArray(companies.id, companyIds));
}
