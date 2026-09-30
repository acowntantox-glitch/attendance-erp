/**
 * Batch 12 — company attendance policy persistence. One row per company (unique `company_id`);
 * every query is scoped by `companyId`, and the upsert's conflict target is that same unique
 * index, so two concurrent first-time saves for one company cannot create two rows.
 */
import { eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { attendancePolicies } from "@/db/schema";
import type { AttendancePolicy, AttendancePolicyRow } from "../model";

export const attendancePolicyRepository = {
  async getByCompanyId(companyId: string, executor: DbExecutor = db): Promise<AttendancePolicyRow | null> {
    const rows = await executor.select().from(attendancePolicies).where(eq(attendancePolicies.companyId, companyId)).limit(1);
    return rows[0] ?? null;
  },

  async upsert(companyId: string, policy: AttendancePolicy, updatedByUserId: string | null, executor: DbExecutor = db): Promise<AttendancePolicyRow> {
    const rows = await executor
      .insert(attendancePolicies)
      .values({ companyId, ...policy, updatedByUserId })
      .onConflictDoUpdate({
        target: attendancePolicies.companyId,
        set: { ...policy, updatedByUserId },
      })
      .returning();
    return rows[0]!;
  },
};
