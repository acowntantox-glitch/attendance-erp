/**
 * Batch 7 — HR monthly attendance calendar/matrix. Strictly read-only over `attendance_daily_records`
 * (Batch 6's exact reporting layer, extended from a date range to a full-month matrix) — never
 * `attendance_events`, never a recalculation. An employee/work-date with no
 * `attendance_daily_records` row simply produces no row here; the service layer (not this
 * repository) is what turns "no row" into the "UNPROCESSED" cell state — this repository never
 * fabricates a status.
 *
 * Employee population policy matches Batch 6's report exactly (§24): no `isArchived`/
 * `employmentStatus` filter is applied — an archived employee still shows their historical month
 * if they match the department/location/search filters, the same "no independently invented
 * archived-employee policy" Batch 6 already established.
 */
import { and, asc, count, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { attendanceDailyRecords, branches, departments, employees } from "@/db/schema";
import type { AttendanceDailyStatus } from "../model";

export type AttendanceCalendarEmployeeFilters = {
  search?: string;
  departmentId?: string;
  locationId?: string;
};

export type AttendanceCalendarEmployeeRow = {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  locationName: string | null;
};

export type AttendanceCalendarDailyRecord = {
  employeeId: string;
  workDate: string;
  status: AttendanceDailyStatus;
  workedMinutes: number | null;
};

/** Company-scoped, and every filter (`departmentId`/`locationId`/`search`) is applied on the
 *  `employees` row itself, filtered by `employees.companyId` — a client-supplied id from another
 *  company simply never matches any employee row (§23/§29 tenant-isolation-through-the-query). */
function buildEmployeeConditions(companyId: string, filters: AttendanceCalendarEmployeeFilters) {
  const conditions = [eq(employees.companyId, companyId)];
  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  if (filters.locationId) conditions.push(eq(employees.locationId, filters.locationId));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(or(ilike(employees.firstName, term), ilike(employees.lastName, term), ilike(employees.employeeNumber, term))!);
  }
  return and(...conditions)!;
}

export const attendanceCalendarRepository = {
  /** The matrix's rows for one page — deterministic order (firstName/lastName, then id), matching
   *  the employee directory's own default sort. */
  listEmployeePage(
    companyId: string,
    filters: AttendanceCalendarEmployeeFilters,
    pagination: { page: number; pageSize: number },
    executor: DbExecutor = db,
  ): Promise<AttendanceCalendarEmployeeRow[]> {
    return executor
      .select({
        id: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        departmentName: departments.name,
        locationName: branches.name,
      })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(branches, eq(employees.locationId, branches.id))
      .where(buildEmployeeConditions(companyId, filters))
      .orderBy(asc(employees.firstName), asc(employees.lastName), asc(employees.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);
  },

  async countEmployees(companyId: string, filters: AttendanceCalendarEmployeeFilters, executor: DbExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: count() })
      .from(employees)
      .where(buildEmployeeConditions(companyId, filters));
    return rows[0]?.value ?? 0;
  },

  /** Every daily record for exactly the given employee ids within the month's date bounds — one
   *  query for the whole page of employees (not one per employee), used to build both the matrix
   *  cells and (aggregated in the service layer, in memory, over this already-bounded
   *  pageSize×~31-day result set) each row's monthly totals. */
  listDailyRecordsForEmployees(
    companyId: string,
    employeeIds: string[],
    fromDate: string,
    toDate: string,
    executor: DbExecutor = db,
  ): Promise<AttendanceCalendarDailyRecord[]> {
    if (employeeIds.length === 0) return Promise.resolve([]);
    return executor
      .select({
        employeeId: attendanceDailyRecords.employeeId,
        workDate: attendanceDailyRecords.workDate,
        status: attendanceDailyRecords.status,
        workedMinutes: attendanceDailyRecords.workedMinutes,
      })
      .from(attendanceDailyRecords)
      .where(
        and(
          eq(attendanceDailyRecords.companyId, companyId),
          inArray(attendanceDailyRecords.employeeId, employeeIds),
          gte(attendanceDailyRecords.workDate, fromDate),
          lte(attendanceDailyRecords.workDate, toDate),
        ),
      );
  },

  /** One row per (workDate, status) actually present — bounded by `daysInMonth × statusCount`
   *  (at most ~279 rows) regardless of company size, since employees collapse into the GROUP BY.
   *  Scoped by the SAME `buildEmployeeConditions` as the paginated employee list, so the bottom
   *  totals row always describes the whole filtered population, never just the current page
   *  (§16/§17) — this is a dedicated aggregate query, not a loop over employees. */
  getDailyTotals(
    companyId: string,
    filters: AttendanceCalendarEmployeeFilters,
    fromDate: string,
    toDate: string,
    executor: DbExecutor = db,
  ): Promise<{ workDate: string; status: AttendanceDailyStatus; value: number }[]> {
    return executor
      .select({ workDate: attendanceDailyRecords.workDate, status: attendanceDailyRecords.status, value: sql<number>`count(*)::int` })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .where(
        and(
          eq(attendanceDailyRecords.companyId, companyId),
          gte(attendanceDailyRecords.workDate, fromDate),
          lte(attendanceDailyRecords.workDate, toDate),
          buildEmployeeConditions(companyId, filters),
        ),
      )
      .groupBy(attendanceDailyRecords.workDate, attendanceDailyRecords.status);
  },

  /** One row per status present across the whole filtered population for the month — the
   *  month-level summary cards' source (§17), same "full filtered set, not the current page"
   *  guarantee as `getDailyTotals`. */
  getMonthStatusCounts(
    companyId: string,
    filters: AttendanceCalendarEmployeeFilters,
    fromDate: string,
    toDate: string,
    executor: DbExecutor = db,
  ): Promise<{ status: AttendanceDailyStatus; value: number }[]> {
    return executor
      .select({ status: attendanceDailyRecords.status, value: sql<number>`count(*)::int` })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(attendanceDailyRecords.employeeId, employees.id))
      .where(
        and(
          eq(attendanceDailyRecords.companyId, companyId),
          gte(attendanceDailyRecords.workDate, fromDate),
          lte(attendanceDailyRecords.workDate, toDate),
          buildEmployeeConditions(companyId, filters),
        ),
      )
      .groupBy(attendanceDailyRecords.status);
  },
};
