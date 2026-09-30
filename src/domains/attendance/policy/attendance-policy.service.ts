/**
 * Batch 12 — company attendance policy. Owns permission checks, validation and audit; the
 * repository only persists. The policy never duplicates Workforce (shift/schedule/break/holiday)
 * data and is not a settings framework — it is exactly four numbers (see `AttendancePolicy`).
 *
 * Applying a policy: `resolveAttendancePolicy` is what the central recalculation path
 * (`recalculateDailyRecordInternal`) calls. A policy change applies only to calculations performed
 * AFTER it is saved — nothing here recalculates existing records, and closed attendance periods
 * stay protected by the existing period lock (a recalculation of a closed period is refused
 * before the policy is ever read). Grace is the one exception in kind: it is frozen on each
 * session at check-in, so past sessions never change even when recalculated.
 */
import type { DbExecutor } from "@/db/client";
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { ValidationError } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { updateAttendancePolicySchema, type UpdateAttendancePolicyInput } from "@/validations/attendance";
import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicy, type AttendancePolicyRow } from "../model";
import { attendancePolicyRepository } from "./attendance-policy.repository";

/** Safe-to-return view: no ids other than the policy's own, and an explicit flag for "never configured". */
export type AttendancePolicyView = AttendancePolicy & {
  /** True when the company has no saved policy and these are the built-in defaults. */
  isDefault: boolean;
  updatedAt: Date | null;
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
  if (!row) return { ...DEFAULT_ATTENDANCE_POLICY, isDefault: true, updatedAt: null };
  return { ...toPolicy(row), isDefault: false, updatedAt: row.updatedAt };
}

/**
 * Internal, permission-free read for the calculation path — the caller has already authorized the
 * attendance action it is performing. Scoped to `companyId` from the request context; a company
 * with no row gets `DEFAULT_ATTENDANCE_POLICY`, so behavior is unchanged until a policy is saved.
 */
export async function resolveAttendancePolicy(companyId: string, executor?: DbExecutor): Promise<AttendancePolicy> {
  const row = await attendancePolicyRepository.getByCompanyId(companyId, executor);
  return row ? toPolicy(row) : DEFAULT_ATTENDANCE_POLICY;
}

export async function getAttendancePolicy(ctx: RequestContext): Promise<AttendancePolicyView> {
  requirePermission(ctx, "attendance.policy.view");
  return toView(await attendancePolicyRepository.getByCompanyId(ctx.companyId));
}

export async function updateAttendancePolicy(ctx: RequestContext, input: UpdateAttendancePolicyInput): Promise<AttendancePolicyView> {
  requirePermission(ctx, "attendance.policy.update");

  const parsed = updateAttendancePolicySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid attendance policy.", parsed.error.flatten());
  }

  const before = await attendancePolicyRepository.getByCompanyId(ctx.companyId);
  const row = await attendancePolicyRepository.upsert(ctx.companyId, parsed.data, ctx.userId);

  await recordAuditLog(ctx, {
    action: "attendance.policy.update",
    entityType: "attendance_policy",
    entityId: row.id,
    oldData: before ? toPolicy(before) : null,
    newData: toPolicy(row),
  });
  return toView(row);
}

