/**
 * Batch 8 — attendance period closing/locking. Owns the business rules; the repository only does
 * company-scoped queries/row-locking. The one function every other attendance mutation must call
 * before writing anything is `assertAttendancePeriodOpen` — centralized here, not re-implemented
 * per call site (§10).
 */
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { AuthorizationError } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { db, type Transaction } from "@/db/client";
import { attendanceSessionRepository } from "../repository";
import { firstDayOfMonth, lastDayOfMonth } from "../calendar/attendance-calendar.service";
import { attendanceCalendarRepository } from "../calendar/attendance-calendar.repository";
import { attendancePeriodRepository, type AttendancePeriod } from "./attendance-period.repository";
import {
  AttendancePeriodAlreadyClosedError,
  AttendancePeriodAlreadyOpenError,
  AttendancePeriodHasOpenSessionsError,
  AttendancePeriodLockedError,
} from "../errors";

export type AttendancePeriodView = {
  periodMonth: string;
  status: "OPEN" | "CLOSED";
  closedAt: Date | null;
  closedByName: string | null;
};

function toView(periodMonth: string, period: (AttendancePeriod & { closedBy: { fullName: string } | null }) | undefined): AttendancePeriodView {
  if (!period) return { periodMonth, status: "OPEN", closedAt: null, closedByName: null };
  return { periodMonth, status: period.status, closedAt: period.closedAt, closedByName: period.closedBy?.fullName ?? null };
}

function requirePeriodViewAccess(ctx: RequestContext): void {
  if (!can(ctx.role, "attendance.period.lock") && !can(ctx.role, "attendance.period.unlock")) {
    throw new AuthorizationError("You do not have permission to view attendance periods.");
  }
}

/**
 * The centralized guard (§10). Takes an already-open `tx` — never `db` directly — because the
 * SHARE lock it acquires on the period row only means anything while held for the duration of the
 * caller's own mutation, not just for this one SELECT (see the repository's module doc for the
 * full concurrency reasoning behind SHARE-vs-UPDATE locking).
 */
export async function assertAttendancePeriodOpen(companyId: string, workDate: string, tx: Transaction): Promise<void> {
  const periodMonth = workDate.slice(0, 7);
  await attendancePeriodRepository.ensure(companyId, periodMonth, tx);
  const period = await attendancePeriodRepository.findForShare(companyId, periodMonth, tx);
  if (period.status === "CLOSED") {
    throw new AttendancePeriodLockedError(periodMonth);
  }
}

/** Fast, non-locking check for entry-gating a bulk operation before doing real work (e.g.
 *  `processCompanyAttendanceDay`'s upfront rejection) — a plain read, not the authoritative
 *  concurrency-safe guard. The authoritative check still happens via `assertAttendancePeriodOpen`
 *  inside each actual mutation's own transaction; this is purely a fast-fail optimization so a
 *  closed period doesn't have to loop over every employee just to fail N times. */
export async function isAttendancePeriodClosed(companyId: string, periodMonth: string): Promise<boolean> {
  const period = await attendancePeriodRepository.findByCompanyAndMonth(companyId, periodMonth);
  return period?.status === "CLOSED";
}

export async function getAttendancePeriod(ctx: RequestContext, periodMonth: string): Promise<AttendancePeriodView> {
  requirePeriodViewAccess(ctx);
  const period = await attendancePeriodRepository.findByCompanyAndMonthWithDetails(ctx.companyId, periodMonth);
  return toView(periodMonth, period);
}

function lastNMonths(count: number): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth() - i; // may go negative; Date normalizes it below
    const d = new Date(Date.UTC(year, monthIndex, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/** The current month plus the previous `monthsBack` — months never explicitly touched are
 *  synthesized as a virtual OPEN entry (no row exists), never fabricated as anything else. */
export async function listAttendancePeriods(ctx: RequestContext, monthsBack = 11): Promise<AttendancePeriodView[]> {
  requirePeriodViewAccess(ctx);
  const months = lastNMonths(monthsBack + 1);
  const rows = await attendancePeriodRepository.listByCompanyWithDetails(ctx.companyId);
  const byMonth = new Map(rows.map((r) => [r.periodMonth, r]));
  return months.map((month) => toView(month, byMonth.get(month)));
}

/**
 * Read-only precondition preview for the close confirmation UI (§18/§19) — computed from the
 * exact same Batch 7 calendar aggregates (`attendanceCalendarRepository`), not a second
 * "unprocessed" calculation. `openSessionCount > 0` is the only thing that actually blocks
 * closing; `unprocessedEmployeeDays` is surfaced as information only (§19's "warn but allow"
 * choice — see `closeAttendancePeriod`'s own doc for the full reasoning).
 */
export async function previewAttendancePeriodClose(
  ctx: RequestContext,
  periodMonth: string,
): Promise<{ openSessionCount: number; unprocessedEmployeeDays: number }> {
  requirePermission(ctx, "attendance.period.lock");
  const fromDate = firstDayOfMonth(periodMonth);
  const toDate = lastDayOfMonth(periodMonth);

  const [openSessionCount, totalEmployees, statusRows] = await Promise.all([
    attendanceSessionRepository.countOpenInRange(ctx.companyId, fromDate, toDate),
    attendanceCalendarRepository.countEmployees(ctx.companyId, {}),
    attendanceCalendarRepository.getMonthStatusCounts(ctx.companyId, {}, fromDate, toDate),
  ]);

  const daysInMonth = new Date(Date.UTC(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 0)).getUTCDate();
  const processedEmployeeDays = statusRows.reduce((sum, row) => sum + row.value, 0);
  const possibleEmployeeDays = totalEmployees * daysInMonth;

  return { openSessionCount, unprocessedEmployeeDays: Math.max(0, possibleEmployeeDays - processedEmployeeDays) };
}

/**
 * §19 decision — unprocessed employee-days WARN but do not BLOCK closing; only unresolved OPEN
 * SESSIONS block it. Reasoning: Batch 5 already made "processing" an entirely optional, manual,
 * HR-triggered action — attendance_daily_records for a given day may legitimately never exist
 * (an employee who was simply never looked at), and forcing 100% processing before every close
 * would make closing far stricter than the rest of this architecture ever requires, and would
 * silently invite HR to just click "Process Day" for everyone right before closing — which this
 * batch explicitly does NOT want to encourage as an automatic side effect of closing itself ("do
 * not automatically process missing days during closing"). Open sessions are different in kind:
 * an open session is *active, unresolved, incomplete state*, not merely "not yet looked at" — and
 * closing over one would either freeze it permanently open or force fabricating a checkout, both
 * explicitly forbidden. That is the one precondition that hard-blocks.
 *
 * §20 atomicity: everything from the exclusive row lock through the status write happens inside
 * one transaction — any thrown error rolls the whole thing back, so a period can never end up
 * partially closed. §24 race safety: the exclusive lock this acquires on the period row is the
 * same row every mutation's `assertAttendancePeriodOpen` takes a SHARE lock on, so this genuinely
 * serializes against concurrent mutations (see the repository's module doc).
 */
export async function closeAttendancePeriod(ctx: RequestContext, periodMonth: string): Promise<AttendancePeriodView> {
  requirePermission(ctx, "attendance.period.lock");

  const fromDate = firstDayOfMonth(periodMonth);
  const toDate = lastDayOfMonth(periodMonth);

  const closed = await db.transaction(async (tx) => {
    await attendancePeriodRepository.ensure(ctx.companyId, periodMonth, tx);
    const period = await attendancePeriodRepository.findForUpdate(ctx.companyId, periodMonth, tx);
    if (period.status === "CLOSED") throw new AttendancePeriodAlreadyClosedError();

    const openSessionCount = await attendanceSessionRepository.countOpenInRange(ctx.companyId, fromDate, toDate, tx);
    if (openSessionCount > 0) throw new AttendancePeriodHasOpenSessionsError(openSessionCount);

    return attendancePeriodRepository.close(period.id, ctx.userId, tx);
  });

  await recordAuditLog(ctx, {
    action: "attendance.period.close",
    entityType: "attendance_period",
    entityId: closed.id,
    oldData: { status: "OPEN" },
    newData: closed,
    metadata: { periodMonth, companyId: ctx.companyId },
  });

  return toView(periodMonth, { ...closed, closedBy: null });
}

/** §21/§22 — `attendance.period.unlock` is used exactly as it already exists (currently granted
 *  only to COMPANY_ADMIN/SUPER_ADMIN via their full-permission grant — HR_ADMIN itself cannot
 *  reopen, only close; see rbac.ts). Same atomic/locked pattern as closing. */
export async function reopenAttendancePeriod(ctx: RequestContext, periodMonth: string): Promise<AttendancePeriodView> {
  requirePermission(ctx, "attendance.period.unlock");

  const reopened = await db.transaction(async (tx) => {
    await attendancePeriodRepository.ensure(ctx.companyId, periodMonth, tx);
    const period = await attendancePeriodRepository.findForUpdate(ctx.companyId, periodMonth, tx);
    if (period.status === "OPEN") throw new AttendancePeriodAlreadyOpenError();
    return attendancePeriodRepository.reopen(period.id, tx);
  });

  await recordAuditLog(ctx, {
    action: "attendance.period.reopen",
    entityType: "attendance_period",
    entityId: reopened.id,
    oldData: { status: "CLOSED" },
    newData: reopened,
    metadata: { periodMonth, companyId: ctx.companyId },
  });

  return toView(periodMonth, { ...reopened, closedBy: null });
}
