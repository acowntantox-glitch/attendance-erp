/**
 * Batch 6 — HR attendance reporting. Reads only `attendance_daily_records` (already-derived
 * state) joined to `employees`/`departments`/`branches` for display names — never
 * `attendance_events`, never a second calculation of worked/late/overtime minutes. An
 * employee/work-date with no `attendance_daily_records` row simply produces no row here; this
 * layer never fabricates ABSENT (that's Batch 5's `processCompanyAttendanceDay`'s job).
 *
 * A dedicated repository rather than reuse of `attendanceDashboardRepository.listTableRows`:
 * the dashboard's query is a LEFT JOIN for exactly one work date (so every active employee
 * appears, record or not); the report is an INNER JOIN over a date *range* (only rows that
 * actually exist, potentially many per employee) — different enough in shape that forcing one
 * into the other would be more convoluted than the two small queries below.
 */
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { attendanceDailyRecords, branches, departments, employees } from "@/db/schema";
import type { AttendanceDailyStatus } from "../model";

export type AttendanceReportFilters = {
  fromDate: string;
  toDate: string;
  employeeId?: string;
  departmentId?: string;
  locationId?: string;
  status?: AttendanceDailyStatus;
  search?: string;
};

export type AttendanceReportRow = {
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  locationName: string | null;
  workDate: string;
  status: AttendanceDailyStatus;
  scheduledMinutes: number;
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  overtimeMinutes: number | null;
};

/** Every report query is scoped by BOTH `attendance_daily_records.company_id` and
 *  `employees.company_id` — belt-and-suspenders tenant isolation, so a client-supplied
 *  `employeeId`/`departmentId`/`locationId` from another company can never match a row even if
 *  one of the two company columns were ever inconsistent (see §29 — never trust these ids without
 *  company validation through the query itself). */
function buildConditions(companyId: string, filters: AttendanceReportFilters) {
  const conditions = [
    eq(attendanceDailyRecords.companyId, companyId),
    eq(employees.companyId, companyId),
    gte(attendanceDailyRecords.workDate, filters.fromDate),
    lte(attendanceDailyRecords.workDate, filters.toDate),
  ];
  if (filters.employeeId) conditions.push(eq(attendanceDailyRecords.employeeId, filters.employeeId));
  if (filters.status) conditions.push(eq(attendanceDailyRecords.status, filters.status));
  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  if (filters.locationId) conditions.push(eq(employees.locationId, filters.locationId));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(employees.firstName, term), ilike(employees.lastName, term), ilike(employees.employeeNumber, term))!);
  }
  return and(...conditions)!;
}

export const attendanceReportRepository = {
  /** Deterministic order: workDate DESC (most recent first, matching the dashboard's own
   *  recency-first convention), then firstName/lastName ASC (the same tiebreak
   *  `employeeRepository`'s default "name_asc" sort uses), then the record id as a final
   *  guaranteed-unique tiebreak so two employees sharing a name never produce a non-deterministic
   *  page boundary. */
  listRows(
    companyId: string,
    filters: AttendanceReportFilters,
    pagination: { page: number; pageSize: number },
    executor: DbExecutor = db,
  ): Promise<AttendanceReportRow[]> {
    return executor
      .select({
        employeeId: attendanceDailyRecords.employeeId,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        departmentName: departments.name,
        locationName: branches.name,
        workDate: attendanceDailyRecords.workDate,
        status: attendanceDailyRecords.status,
        scheduledMinutes: attendanceDailyRecords.scheduledMinutes,
        workedMinutes: attendanceDailyRecords.workedMinutes,
        lateMinutes: attendanceDailyRecords.lateMinutes,
        earlyDepartureMinutes: attendanceDailyRecords.earlyDepartureMinutes,
        overtimeMinutes: attendanceDailyRecords.overtimeMinutes,
      })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(branches, eq(employees.locationId, branches.id))
      .where(buildConditions(companyId, filters))
      .orderBy(desc(attendanceDailyRecords.workDate), asc(employees.firstName), asc(employees.lastName), asc(attendanceDailyRecords.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);
  },

  /** Same row shape and ordering as `listRows`, but unpaginated up to `maxRows` — the CSV
   *  exporter's source. Sharing `buildConditions` (not a second filter implementation) is what
   *  guarantees the export can never drift from what the report page shows for the same filters. */
  listAllRowsForExport(
    companyId: string,
    filters: AttendanceReportFilters,
    maxRows: number,
    executor: DbExecutor = db,
  ): Promise<AttendanceReportRow[]> {
    return executor
      .select({
        employeeId: attendanceDailyRecords.employeeId,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        departmentName: departments.name,
        locationName: branches.name,
        workDate: attendanceDailyRecords.workDate,
        status: attendanceDailyRecords.status,
        scheduledMinutes: attendanceDailyRecords.scheduledMinutes,
        workedMinutes: attendanceDailyRecords.workedMinutes,
        lateMinutes: attendanceDailyRecords.lateMinutes,
        earlyDepartureMinutes: attendanceDailyRecords.earlyDepartureMinutes,
        overtimeMinutes: attendanceDailyRecords.overtimeMinutes,
      })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(branches, eq(employees.locationId, branches.id))
      .where(buildConditions(companyId, filters))
      .orderBy(desc(attendanceDailyRecords.workDate), asc(employees.firstName), asc(employees.lastName), asc(attendanceDailyRecords.id))
      .limit(maxRows);
  },

  async countRows(companyId: string, filters: AttendanceReportFilters, executor: DbExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: sql<number>`count(*)::int` })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .where(buildConditions(companyId, filters));
    return rows[0]?.value ?? 0;
  },

  /** One row per status present in the filtered population — callers fill in zero for every
   *  status with no row, same convention as `attendanceDashboardRepository.getStatusCounts`. */
  getStatusCounts(
    companyId: string,
    filters: AttendanceReportFilters,
    executor: DbExecutor = db,
  ): Promise<{ status: AttendanceDailyStatus; value: number }[]> {
    return executor
      .select({ status: attendanceDailyRecords.status, value: sql<number>`count(*)::int` })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .where(buildConditions(companyId, filters))
      .groupBy(attendanceDailyRecords.status);
  },

  /** Minute totals over the entire filtered population (never just the current page) — the same
   *  filter conditions as every other query here, so the summary can never disagree with what the
   *  filters actually select. `workedMinutes`/`overtimeMinutes` are nullable per row (INCOMPLETE
   *  days); `sum()` over Postgres already skips nulls, so this is a true sum of the *known* worked
   *  minutes, not a sum that silently treated unknown as zero. */
  async getMinutesTotals(
    companyId: string,
    filters: AttendanceReportFilters,
    executor: DbExecutor = db,
  ): Promise<{ totalScheduledMinutes: number; totalWorkedMinutes: number; totalOvertimeMinutes: number }> {
    const rows = await executor
      .select({
        totalScheduledMinutes: sql<number>`coalesce(sum(${attendanceDailyRecords.scheduledMinutes}), 0)::int`,
        totalWorkedMinutes: sql<number>`coalesce(sum(${attendanceDailyRecords.workedMinutes}), 0)::int`,
        totalOvertimeMinutes: sql<number>`coalesce(sum(${attendanceDailyRecords.overtimeMinutes}), 0)::int`,
      })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .where(buildConditions(companyId, filters));
    return rows[0] ?? { totalScheduledMinutes: 0, totalWorkedMinutes: 0, totalOvertimeMinutes: 0 };
  },
};
