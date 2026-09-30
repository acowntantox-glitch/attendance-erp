import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { companyMemberships, employees, users } from "@/db/schema";

/** A member of one company, as an administrator sees them. Explicit columns only: there is no way
 *  for `password_hash` (or any session token) to be selected through this repository. */
export type CompanyUserRow = {
  userId: string;
  membershipId: string;
  fullName: string;
  email: string;
  role: (typeof companyMemberships.$inferSelect)["role"];
  membershipActive: boolean;
  accountDisabled: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  employeeNumber: string | null;
};

export type MembershipTarget = {
  membershipId: string;
  userId: string;
  role: CompanyUserRow["role"];
  membershipActive: boolean;
  email: string;
  fullName: string;
};

export const userManagementRepository = {
  /** Every member of `companyId` — the company condition is in the query itself, not applied after. */
  listForCompany(companyId: string, executor: DbExecutor = db): Promise<CompanyUserRow[]> {
    return executor
      .select({
        userId: users.id,
        membershipId: companyMemberships.id,
        fullName: users.fullName,
        email: users.email,
        role: companyMemberships.role,
        membershipActive: companyMemberships.isActive,
        accountDisabled: sql<boolean>`${users.status} <> 'active'`,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
        employeeNumber: employees.employeeNumber,
      })
      .from(companyMemberships)
      .innerJoin(users, eq(users.id, companyMemberships.userId))
      .leftJoin(employees, and(eq(employees.userId, users.id), eq(employees.companyId, companyId)))
      .where(eq(companyMemberships.companyId, companyId))
      .orderBy(asc(users.fullName), asc(users.email))
      .limit(1000);
  },

  /**
   * The user's membership in THIS company, locked `FOR UPDATE` so a concurrent status change or reset
   * of the same member serializes. Returns undefined for a user who is not a member of `companyId` —
   * indistinguishable from a user that does not exist, so callers answer 404 either way and never
   * reveal that an id belongs to another tenant.
   */
  async findMembershipForUpdate(companyId: string, userId: string, executor: DbExecutor): Promise<MembershipTarget | undefined> {
    const rows = await executor
      .select({
        membershipId: companyMemberships.id,
        userId: companyMemberships.userId,
        role: companyMemberships.role,
        membershipActive: companyMemberships.isActive,
        email: users.email,
        fullName: users.fullName,
      })
      .from(companyMemberships)
      .innerJoin(users, eq(users.id, companyMemberships.userId))
      .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.userId, userId)))
      .for("update", { of: companyMemberships });
    return rows[0];
  },

  /** Memberships the user holds in companies OTHER than `companyId`. */
  async countMembershipsInOtherCompanies(userId: string, companyId: string, executor: DbExecutor): Promise<number> {
    const rows = await executor
      .select({ value: sql<number>`count(*)::int` })
      .from(companyMemberships)
      .where(and(eq(companyMemberships.userId, userId), ne(companyMemberships.companyId, companyId)));
    return rows[0]?.value ?? 0;
  },

  async setMembershipActive(membershipId: string, isActive: boolean, executor: DbExecutor): Promise<void> {
    await executor.update(companyMemberships).set({ isActive }).where(eq(companyMemberships.id, membershipId));
  },

  async setPassword(userId: string, passwordHash: string, mustChangePassword: boolean, executor: DbExecutor): Promise<void> {
    await executor.update(users).set({ passwordHash, mustChangePassword }).where(eq(users.id, userId));
  },
};
