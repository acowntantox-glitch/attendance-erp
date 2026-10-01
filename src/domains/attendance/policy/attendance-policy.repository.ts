/**
 * Batch 12 - company attendance policy persistence. F-06: effective-dated. One row per (company,
 * `effective_from`); every query is scoped by `companyId`. The row that governs a work date is the
 * latest one starting on or before it (`getEffectiveFor`), so a newer row never changes how an earlier
 * date is calculated. The upsert's conflict target is the (company, effective_from) unique index, so
 * two concurrent first-time saves for the same start date cannot create two rows.
 */
import { and, desc, eq, lte } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { attendancePolicies } from "@/db/schema";
import type { AttendancePolicy, AttendancePolicyRow } from "../model";

export const attendancePolicyRepository = {
  /** The policy row in force on `workDate` (latest `effective_from` <= workDate), or null when none
   *  has started yet - the caller then uses the built-in defaults. */
  async getEffectiveFor(companyId: string, workDate: string, executor: DbExecutor = db): Promise<AttendancePolicyRow | null> {
    const rows = await executor
      .select()
      .from(attendancePolicies)
      .where(and(eq(attendancePolicies.companyId, companyId), lte(attendancePolicies.effectiveFrom, workDate)))
      .orderBy(desc(attendancePolicies.effectiveFrom))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Creates the policy starting on `effectiveFrom`, or updates the row that already starts that day. */
  async upsert(
    companyId: string,
    effectiveFrom: string,
    policy: AttendancePolicy,
    updatedByUserId: string | null,
    executor: DbExecutor = db,
  ): Promise<AttendancePolicyRow> {
    const rows = await executor
      .insert(attendancePolicies)
      .values({ companyId, effectiveFrom, ...policy, updatedByUserId })
      .onConflictDoUpdate({
        target: [attendancePolicies.companyId, attendancePolicies.effectiveFrom],
        set: { ...policy, updatedByUserId },
      })
      .returning();
    return rows[0]!;
  },
};
