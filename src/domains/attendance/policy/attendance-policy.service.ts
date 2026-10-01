/**
 * Batch 12 — company attendance policy. Owns permission checks, validation and audit; the
 * repository only persists. The policy never duplicates Workforce (shift/schedule/break/holiday)
 * data and is not a settings framework — it is exactly four numbers (see `AttendancePolicy`).
 *
 * Applying a policy (F-06): `resolveAttendancePolicy(companyId, workDate)` is what the central
 * calculation path calls, and it returns the policy EFFECTIVE ON THAT WORK DATE. Saving a policy
 * starts a new row effective from the company's local "today", so a change affects today and later
 * dates only: recalculating, correcting or processing an earlier date keeps using the policy that was
 * in force then. Nothing here recalculates existing records, and closed attendance periods stay
 * protected by the period lock. Grace is additionally frozen on each session at check-in.
 *
 * Remaining limitation (Attendance Policy phase): there is no UI/API for a future-dated or backdated
 * effective date yet, and the Workforce inputs to a calculation (holidays, the company weekly-off
 * default, branch timezone) are still read as they are today - they are not versioned here.
 */
import type { DbExecutor } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { ValidationError } from "@/lib/errors";
import { utcToZonedWallTime } from "@/lib/datetime";
import { companyRepository } from "@/domains/organization/repository";
import { recordAuditLog } from "@/domains/audit/service";
import { updateAttendancePolicySchema, type UpdateAttendancePolicyInput } from "@/validations/attendance";
import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicy, type AttendancePolicyRow } from "../model";
import { attendancePolicyRepository } from "./attendance-policy.repository";

/** Safe-to-return view: no ids other than the policy's own, and an explicit flag for "never configured". */
export type AttendancePolicyView = AttendancePolicy & {
  /** True when the company has no saved policy and these are the built-in defaults. */
  isDefault: boolean;
  updatedAt: Date | null;
  /** First work date the policy applies to (null for the built-in defaults). */
  effectiveFrom: string | null;
};

function toPolicy(row: AttendancePolicyRow): AttendancePolicy {
  return {
    defaultGracePeriodMinutes: row.defaultGracePeriodMinutes,
    earlyDepartureGraceMinutes: row.earlyDepartureGraceMinutes,
    overtimeThresholdMinutes: row.overtimeThresholdMinutes,
    minimumWorkedMinutes: row.minimumWorkedMinutes,
  };
}

function toView(row: AttendancePolicyRow | null): AttendancePolicyView {
  if (!row) return { ...DEFAULT_ATTENDANCE_POLICY, isDefault: true, updatedAt: null, effectiveFrom: null };
  return { ...toPolicy(row), isDefault: false, updatedAt: row.updatedAt, effectiveFrom: row.effectiveFrom };
}

/**
 * Internal, permission-free read for the calculation path - the caller has already authorized the
 * attendance action it is performing. Scoped to `companyId`; returns the policy effective on
 * `workDate` (F-06), or `DEFAULT_ATTENDANCE_POLICY` when none had started by then.
 */
export async function resolveAttendancePolicy(companyId: string, workDate: string, executor?: DbExecutor): Promise<AttendancePolicy> {
  const row = await attendancePolicyRepository.getEffectiveFor(companyId, workDate, executor);
  return row ? toPolicy(row) : DEFAULT_ATTENDANCE_POLICY;
}

/** The company's local calendar date right now - the effective date of a policy saved at this moment. */
async function companyToday(companyId: string): Promise<string> {
  const company = await companyRepository.findById(companyId);
  return utcToZonedWallTime(new Date(), company?.timezone ?? "UTC").date;
}

export async function getAttendancePolicy(ctx: RequestContext): Promise<AttendancePolicyView> {
  requirePermission(ctx, "attendance.policy.view");
  // The policy in force today (the one an edit would replace).
  return toView(await attendancePolicyRepository.getEffectiveFor(ctx.companyId, await companyToday(ctx.companyId)));
}

export async function updateAttendancePolicy(ctx: RequestContext, input: UpdateAttendancePolicyInput): Promise<AttendancePolicyView> {
  requirePermission(ctx, "attendance.policy.update");

  const parsed = updateAttendancePolicySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid attendance policy.", parsed.error.flatten());
  }

  // Effective from the company's local today: earlier dates keep the policy they were calculated under.
  const effectiveFrom = await companyToday(ctx.companyId);
  const before = await attendancePolicyRepository.getEffectiveFor(ctx.companyId, effectiveFrom);
  const row = await attendancePolicyRepository.upsert(ctx.companyId, effectiveFrom, parsed.data, ctx.userId);

  await recordAuditLog(ctx, {
    action: "attendance.policy.update",
    entityType: "attendance_policy",
    entityId: row.id,
    oldData: before ? { ...toPolicy(before), effectiveFrom: before.effectiveFrom } : null,
    newData: { ...toPolicy(row), effectiveFrom: row.effectiveFrom },
  });
  return toView(row);
}

