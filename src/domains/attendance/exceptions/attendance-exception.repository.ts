/**
 * Batch 10 — attendance exception detection and dismissal metadata. Detection reads only
 * `attendance_daily_records` (already-derived state, exactly like `attendance-report.repository.ts`
 * does) joined to `employees`/`departments`/`branches` for display names — never
 * `attendance_events`, never a second calculation of status/minutes. An employee/work-date with no
 * `attendance_daily_records` row simply produces no row here (UNPROCESSED is not an exception
 * type in this batch); this layer never fabricates one.
 *
 * A single record can, in principle, be simultaneously LATE and have a nonzero
 * `earlyDepartureMinutes`. Rather than emit two rows for one record (which would make the
 * dismissal table's `(employeeId, workDate, exceptionType)` uniqueness ambiguous about "which
 * exception" a single day represents), `exceptionTypeCase` picks exactly one label per record, by
 * priority: a bad status (LATE/INCOMPLETE/ABSENT) always wins over EARLY_DEPARTURE, since a day
 * that's already flagged LATE/INCOMPLETE/ABSENT is not made less notable by also leaving early —
 * that detail is still fully visible on the Batch 9 investigation page either way. EARLY_DEPARTURE
 * is its own exception only when the record is otherwise unremarkable by status (typically
 * PRESENT) but still left early.
 *
 * "Hide dismissed" (the default) is enforced with a LEFT JOIN to `attendance_exception_dismissals`
 * correlated on (employeeId, workDate, and the *computed* exceptionType, cast to text on both
 * sides to avoid enum/unknown-type ambiguity) plus `dismissedByUserId IS NULL` in the WHERE — never
 * as a JavaScript-side filter after the page is fetched, which would silently break pagination
 * (a page could appear sparse or empty even though later pages have undismissed rows). The same
 * join doubles as the dismissal lookup itself: the caller gets `dismissedByUserId`/`dismissedAt`/
 * `note` directly in the row, with zero additional per-row or per-page dismissal query.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { attendanceDailyRecords, attendanceExceptionDismissals, branches, departments, employees } from "@/db/schema";
import type { AttendanceDailyStatus } from "../model";
import type { AttendanceExceptionType } from "@/validations/attendance";

export type AttendanceExceptionFilters = {
  fromDate: string;
  toDate: string;
  types?: AttendanceExceptionType[];
  employeeId?: string;
  departmentId?: string;
  locationId?: string;
  search?: string;
  /** Default false — dismissed rows are excluded from the list/count/summary entirely (not just
   *  visually), so pagination totals always match what's actually shown. */
  includeDismissed?: boolean;
};

export type AttendanceExceptionRow = {
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  locationName: string | null;
  workDate: string;
  exceptionType: AttendanceExceptionType;
  status: AttendanceDailyStatus;
  scheduledMinutes: number;
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  dismissedByUserId: string | null;
  dismissedAt: Date | null;
  dismissalNote: string | null;
};

function exceptionTypeCase() {
  return sql<AttendanceExceptionType>`case
    when ${attendanceDailyRecords.status} = 'LATE' then 'LATE'
    when ${attendanceDailyRecords.status} = 'INCOMPLETE' then 'INCOMPLETE'
    when ${attendanceDailyRecords.status} = 'ABSENT' then 'ABSENT'
    when ${attendanceDailyRecords.earlyDepartureMinutes} > 0 then 'EARLY_DEPARTURE'
  end`;
}

/** Every caller joins `attendance_exception_dismissals` this exact way — kept as one function so
 *  the enum/text-cast correlation is never written twice. */
function dismissalJoinCondition() {
  return and(
    eq(attendanceExceptionDismissals.employeeId, attendanceDailyRecords.employeeId),
    // `attendance_exception_dismissals.work_date` is `text` (per the approved data model — it
    // stores no attendance fact and has no reason to share `attendance_daily_records.work_date`'s
    // real `date` column type), so the join needs an explicit cast on one side.
    sql`${attendanceExceptionDismissals.workDate} = (${attendanceDailyRecords.workDate})::text`,
    sql`${attendanceExceptionDismissals.exceptionType}::text = (${exceptionTypeCase()})::text`,
  );
}

/** Every query below is scoped by BOTH `attendance_daily_records.companyId` and
 *  `employees.companyId` — the same belt-and-suspenders tenant isolation
 *  `attendance-report.repository.ts` already uses, so a client-supplied
 *  `employeeId`/`departmentId`/`locationId` from another company can never match a row. Requires
 *  the caller's query to already have `dismissalJoinCondition()` joined in when
 *  `includeDismissed` is false. */
function buildConditions(companyId: string, filters: AttendanceExceptionFilters) {
  const conditions = [
    eq(attendanceDailyRecords.companyId, companyId),
    eq(employees.companyId, companyId),
    gte(attendanceDailyRecords.workDate, filters.fromDate),
    lte(attendanceDailyRecords.workDate, filters.toDate),
    // The base "is this record an exception at all" test — a single OR, not four separate
    // calculation paths.
    or(inArray(attendanceDailyRecords.status, ["LATE", "INCOMPLETE", "ABSENT"]), sql`${attendanceDailyRecords.earlyDepartureMinutes} > 0`)!,
  ];
  if (filters.types && filters.types.length > 0) {
    conditions.push(inArray(exceptionTypeCase(), filters.types));
  }
  if (filters.employeeId) conditions.push(eq(attendanceDailyRecords.employeeId, filters.employeeId));
  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  if (filters.locationId) conditions.push(eq(employees.locationId, filters.locationId));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(employees.firstName, term), ilike(employees.lastName, term), ilike(employees.employeeNumber, term))!);
  }
  if (!filters.includeDismissed) {
    conditions.push(isNull(attendanceExceptionDismissals.dismissedByUserId));
  }
  return and(...conditions)!;
}

const SELECT_COLUMNS = {
  employeeId: attendanceDailyRecords.employeeId,
  employeeNumber: employees.employeeNumber,
  firstName: employees.firstName,
  lastName: employees.lastName,
  departmentName: departments.name,
  locationName: branches.name,
  workDate: attendanceDailyRecords.workDate,
  exceptionType: exceptionTypeCase(),
  status: attendanceDailyRecords.status,
  scheduledMinutes: attendanceDailyRecords.scheduledMinutes,
  workedMinutes: attendanceDailyRecords.workedMinutes,
  lateMinutes: attendanceDailyRecords.lateMinutes,
  earlyDepartureMinutes: attendanceDailyRecords.earlyDepartureMinutes,
  dismissedByUserId: attendanceExceptionDismissals.dismissedByUserId,
  dismissedAt: attendanceExceptionDismissals.dismissedAt,
  dismissalNote: attendanceExceptionDismissals.note,
} as const;

export const attendanceExceptionRepository = {
  /** Deterministic order: workDate DESC (most recent first, matching the report/dashboard
   *  convention), then employee name ASC, then employee id ASC as a final guaranteed-unique
   *  tiebreak. */
  listExceptions(
    companyId: string,
    filters: AttendanceExceptionFilters,
    pagination: { page: number; pageSize: number },
    executor: DbExecutor = db,
  ): Promise<AttendanceExceptionRow[]> {
    return executor
      .select(SELECT_COLUMNS)
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(branches, eq(employees.locationId, branches.id))
      .leftJoin(attendanceExceptionDismissals, dismissalJoinCondition())
      .where(buildConditions(companyId, filters))
      .orderBy(desc(attendanceDailyRecords.workDate), asc(employees.firstName), asc(employees.lastName), asc(employees.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize) as Promise<AttendanceExceptionRow[]>;
  },

  async countExceptions(companyId: string, filters: AttendanceExceptionFilters, executor: DbExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: sql<number>`count(*)::int` })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .leftJoin(attendanceExceptionDismissals, dismissalJoinCondition())
      .where(buildConditions(companyId, filters));
    return rows[0]?.value ?? 0;
  },

  /** One row per exception type present in the filtered population — for the summary cards.
   *  Same filter conditions as the main list (minus any `types` narrowing, since the summary
   *  shows every type's count regardless of which the caller currently has selected), so it can
   *  never disagree with what the table itself would show for the same date/department/location/
   *  search/dismissed filters. */
  async getExceptionTypeCounts(
    companyId: string,
    filters: Omit<AttendanceExceptionFilters, "types">,
    executor: DbExecutor = db,
  ): Promise<{ exceptionType: AttendanceExceptionType; value: number }[]> {
    return executor
      .select({ exceptionType: exceptionTypeCase(), value: sql<number>`count(*)::int` })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .leftJoin(attendanceExceptionDismissals, dismissalJoinCondition())
      .where(buildConditions(companyId, filters))
      .groupBy(exceptionTypeCase());
  },
};

export const attendanceExceptionDismissalRepository = {
  findOne(companyId: string, employeeId: string, workDate: string, exceptionType: AttendanceExceptionType, executor: DbExecutor = db) {
    return executor.query.attendanceExceptionDismissals.findFirst({
      where: and(
        eq(attendanceExceptionDismissals.companyId, companyId),
        eq(attendanceExceptionDismissals.employeeId, employeeId),
        eq(attendanceExceptionDismissals.workDate, workDate),
        eq(attendanceExceptionDismissals.exceptionType, exceptionType),
      ),
    });
  },

  /** Idempotent — a repeated dismiss of the same (employeeId, workDate, exceptionType) updates
   *  the existing row (new dismisser/timestamp/note) rather than creating a duplicate, relying on
   *  the table's own unique index as the conflict target. */
  async dismiss(
    input: {
      companyId: string;
      employeeId: string;
      workDate: string;
      exceptionType: AttendanceExceptionType;
      dismissedByUserId: string;
      note?: string;
    },
    executor: DbExecutor = db,
  ) {
    const rows = await executor
      .insert(attendanceExceptionDismissals)
      .values({
        companyId: input.companyId,
        employeeId: input.employeeId,
        workDate: input.workDate,
        exceptionType: input.exceptionType,
        dismissedByUserId: input.dismissedByUserId,
        note: input.note ?? null,
      })
      .onConflictDoUpdate({
        target: [attendanceExceptionDismissals.employeeId, attendanceExceptionDismissals.workDate, attendanceExceptionDismissals.exceptionType],
        set: { dismissedByUserId: input.dismissedByUserId, dismissedAt: new Date(), note: input.note ?? null },
      })
      .returning();
    return rows[0]!;
  },

  async undismiss(companyId: string, employeeId: string, workDate: string, exceptionType: AttendanceExceptionType, executor: DbExecutor = db) {
    const rows = await executor
      .delete(attendanceExceptionDismissals)
      .where(
        and(
          eq(attendanceExceptionDismissals.companyId, companyId),
          eq(attendanceExceptionDismissals.employeeId, employeeId),
          eq(attendanceExceptionDismissals.workDate, workDate),
          eq(attendanceExceptionDismissals.exceptionType, exceptionType),
        ),
      )
      .returning();
    return rows[0] ?? null;
  },
};
