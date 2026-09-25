/**
 * Batch 10 — attendance exception queue. A read composition over `attendance_daily_records`
 * (via `attendance-exception.repository.ts`) plus HR dismissal metadata — never a second
 * calculation of status/minutes, never a persisted "exception fact." See the repository's own
 * module doc for the exact detection rule and the dismissal join.
 */
import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { recordAuditLog } from "@/domains/audit/service";
import { employeeRepository } from "@/domains/employee/repository";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { isAttendancePeriodClosed } from "../periods/attendance-period.service";
import { AttendanceExceptionDismissalNotFoundError, AttendanceExceptionNotFoundError } from "../errors";
import {
  attendanceExceptionDismissalRepository,
  attendanceExceptionRepository,
  type AttendanceExceptionFilters,
  type AttendanceExceptionRow,
} from "./attendance-exception.repository";
import type { AttendanceExceptionType } from "@/validations/attendance";

const EXCEPTION_MAX_PAGE_SIZE = 100;
const EXCEPTION_DEFAULT_PAGE_SIZE = 25;
const ALL_EXCEPTION_TYPES: AttendanceExceptionType[] = ["LATE", "INCOMPLETE", "ABSENT", "EARLY_DEPARTURE"];

export type AttendanceExceptionView = Omit<AttendanceExceptionRow, "dismissedByUserId" | "dismissedAt" | "dismissalNote"> & {
  /** Whether `workDate`'s month is closed (Batch 8) — a plain read via `isAttendancePeriodClosed`,
   *  batched once per distinct month on the page, never once per row. */
  periodClosed: boolean;
  dismissal: { dismissedAt: Date; note: string | null } | null;
};

export type AttendanceExceptionListResult = {
  items: AttendanceExceptionView[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  /** Every type's count, zero-filled — same filtered population as `items`, minus any `types`
   *  narrowing (see the repository), so switching the type filter never looks like the summary
   *  "disagrees" with what's shown. */
  summary: Record<AttendanceExceptionType, number>;
};

/** `EMPLOYEE`/`MANAGER` never reach this — neither holds `attendance.report.view` (see rbac.ts) —
 *  so this permission check alone is the entire authorization boundary; no manager-hierarchy
 *  logic is introduced. */
export async function listAttendanceExceptions(
  ctx: RequestContext,
  filters: AttendanceExceptionFilters,
  pagination: { page: number; pageSize: number },
): Promise<AttendanceExceptionListResult> {
  requirePermission(ctx, "attendance.report.view");

  const clampedPagination = {
    page: Math.max(1, pagination.page || 1),
    pageSize: Math.min(EXCEPTION_MAX_PAGE_SIZE, Math.max(1, pagination.pageSize || EXCEPTION_DEFAULT_PAGE_SIZE)),
  };

  const [rows, total, summaryRows] = await Promise.all([
    attendanceExceptionRepository.listExceptions(ctx.companyId, filters, clampedPagination),
    attendanceExceptionRepository.countExceptions(ctx.companyId, filters),
    attendanceExceptionRepository.getExceptionTypeCounts(ctx.companyId, filters),
  ]);

  // Batched — one isAttendancePeriodClosed call per distinct month on the page, never once per
  // row (matching the Batch 8 corrections page's own pattern).
  const distinctMonths = Array.from(new Set(rows.map((r) => r.workDate.slice(0, 7))));
  const closedFlags = await Promise.all(distinctMonths.map((month) => isAttendancePeriodClosed(ctx.companyId, month)));
  const closedMonths = new Set(distinctMonths.filter((_, i) => closedFlags[i]));

  const summary = Object.fromEntries(ALL_EXCEPTION_TYPES.map((type) => [type, 0])) as Record<AttendanceExceptionType, number>;
  for (const row of summaryRows) summary[row.exceptionType] = row.value;

  const items: AttendanceExceptionView[] = rows.map((row) => {
    const { dismissedByUserId, dismissedAt, dismissalNote, ...rest } = row;
    return {
      ...rest,
      periodClosed: closedMonths.has(row.workDate.slice(0, 7)),
      dismissal: dismissedByUserId ? { dismissedAt: dismissedAt!, note: dismissalNote } : null,
    };
  });

  return {
    items,
    pagination: { ...clampedPagination, total, totalPages: Math.max(1, Math.ceil(total / clampedPagination.pageSize)) },
    summary,
  };
}

async function assertExceptionCurrentlyExists(companyId: string, employeeId: string, workDate: string, exceptionType: AttendanceExceptionType) {
  // Reuses the exact same detection query the queue itself uses (never a second, hand-written
  // "is this actually an exception" rule) — scoped to one employee/day so it's a single-row
  // lookup, not "the main queue." §9: a client must never be able to fabricate dismissal metadata
  // for a combination that isn't a live exception right now.
  const rows = await attendanceExceptionRepository.listExceptions(
    companyId,
    { fromDate: workDate, toDate: workDate, employeeId, types: [exceptionType], includeDismissed: true },
    { page: 1, pageSize: 1 },
  );
  if (rows.length === 0) throw new AttendanceExceptionNotFoundError();
}

export type DismissExceptionInput = { employeeId: string; workDate: string; exceptionType: AttendanceExceptionType; note?: string };

export async function dismissException(ctx: RequestContext, input: DismissExceptionInput) {
  requirePermission(ctx, "attendance.exception.manage");

  const employee = await employeeRepository.findById(input.employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  await assertExceptionCurrentlyExists(ctx.companyId, input.employeeId, input.workDate, input.exceptionType);

  const dismissal = await attendanceExceptionDismissalRepository.dismiss({
    companyId: ctx.companyId,
    employeeId: input.employeeId,
    workDate: input.workDate,
    exceptionType: input.exceptionType,
    dismissedByUserId: ctx.userId,
    note: input.note,
  });

  await recordAuditLog(ctx, {
    action: "attendance.exception.dismiss",
    entityType: "attendance_exception_dismissal",
    entityId: dismissal.id,
    newData: dismissal,
    metadata: { employeeId: input.employeeId, workDate: input.workDate, exceptionType: input.exceptionType, note: input.note ?? null },
  });

  return dismissal;
}

export type UndismissExceptionInput = { employeeId: string; workDate: string; exceptionType: AttendanceExceptionType };

export async function undismissException(ctx: RequestContext, input: UndismissExceptionInput) {
  requirePermission(ctx, "attendance.exception.manage");

  const employee = await employeeRepository.findById(input.employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  assertCompanyAccess(ctx, employee.companyId);

  const removed = await attendanceExceptionDismissalRepository.undismiss(ctx.companyId, input.employeeId, input.workDate, input.exceptionType);
  if (!removed) throw new AttendanceExceptionDismissalNotFoundError();

  await recordAuditLog(ctx, {
    action: "attendance.exception.undismiss",
    entityType: "attendance_exception_dismissal",
    entityId: removed.id,
    oldData: removed,
    metadata: { employeeId: input.employeeId, workDate: input.workDate, exceptionType: input.exceptionType },
  });

  return removed;
}
