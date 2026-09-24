/**
 * Batch 7 — HR monthly attendance calendar/matrix. A thin orchestration + presentation-shaping
 * layer over `attendanceCalendarRepository`, itself read-only over `attendance_daily_records`.
 * This module never computes worked/scheduled/late/overtime minutes and never decides a day's
 * status — every status shown is either a real value already stored on a daily record, or the
 * synthetic `"UNPROCESSED"` marker for a work date with no record at all (never `"ABSENT"` —
 * Batch 5's own rule, preserved here at the presentation layer too).
 */
import { attendanceDailyStatusEnum } from "@/db/schema";
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { addDays, enumerateDateRange } from "@/lib/datetime";
import { attendanceCalendarRepository, type AttendanceCalendarEmployeeFilters } from "./attendance-calendar.repository";
import type { AttendanceDailyStatus } from "../model";
import { REPORT_DEFAULT_PAGE_SIZE, REPORT_MAX_PAGE_SIZE } from "../reports/attendance-report.service";

const ALL_DAILY_STATUSES = attendanceDailyStatusEnum.enumValues;

export type AttendanceCalendarCellStatus = AttendanceDailyStatus | "UNPROCESSED";

export type AttendanceCalendarCell = {
  date: string;
  status: AttendanceCalendarCellStatus;
  workedMinutes: number | null;
  /** True only when a real `attendance_daily_records` row exists — the UI uses this (not the
   *  status) to decide whether a cell is clickable, so it never implies an attendance event
   *  exists for an unprocessed or future day. */
  hasRecord: boolean;
};

export type AttendanceCalendarRow = {
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentName: string | null;
  locationName: string | null;
  cells: AttendanceCalendarCell[];
  /** This employee's own month totals — from their real records only, never estimated. */
  totals: Record<AttendanceDailyStatus, number>;
};

export type AttendanceCalendarDailyTotal = { date: string; statusCounts: Record<AttendanceDailyStatus, number> };

export type AttendanceCalendarSummary = {
  totalEmployees: number;
  possibleEmployeeDays: number;
  processedEmployeeDays: number;
  unprocessedEmployeeDays: number;
  statusCounts: Record<AttendanceDailyStatus, number>;
};

export type AttendanceCalendarResult = {
  month: string;
  days: string[];
  rows: AttendanceCalendarRow[];
  dailyTotals: AttendanceCalendarDailyTotal[];
  summary: AttendanceCalendarSummary;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

/** `month` is trusted to already be a validated "YYYY-MM" string (see
 *  `validations/attendance.ts`'s `monthSchema`) — the same trust boundary `getAttendanceReport`
 *  already has for its `fromDate`/`toDate`. Built from the existing `addDays` primitive; not a
 *  second date-utility module. */
function lastDayOfMonth(month: string): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  const nextMonthFirst = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  return addDays(nextMonthFirst, -1);
}

function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

/** For the Previous/Next month navigation links. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  const zeroBased = (mon - 1) + delta;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
}

function emptyStatusCounts(): Record<AttendanceDailyStatus, number> {
  return Object.fromEntries(ALL_DAILY_STATUSES.map((status) => [status, 0])) as Record<AttendanceDailyStatus, number>;
}

export async function getAttendanceCalendar(
  ctx: RequestContext,
  month: string,
  filters: AttendanceCalendarEmployeeFilters,
  pagination: { page: number; pageSize: number },
): Promise<AttendanceCalendarResult> {
  requirePermission(ctx, "attendance.report.view");

  const pageSize = Math.min(REPORT_MAX_PAGE_SIZE, Math.max(1, pagination.pageSize || REPORT_DEFAULT_PAGE_SIZE));
  const page = Math.max(1, pagination.page || 1);

  const fromDate = firstDayOfMonth(month);
  const toDate = lastDayOfMonth(month);
  const days = enumerateDateRange(fromDate, toDate);

  const [employeePage, totalEmployees, dailyTotalRows, monthStatusRows] = await Promise.all([
    attendanceCalendarRepository.listEmployeePage(ctx.companyId, filters, { page, pageSize }),
    attendanceCalendarRepository.countEmployees(ctx.companyId, filters),
    attendanceCalendarRepository.getDailyTotals(ctx.companyId, filters, fromDate, toDate),
    attendanceCalendarRepository.getMonthStatusCounts(ctx.companyId, filters, fromDate, toDate),
  ]);

  const employeeIds = employeePage.map((e) => e.id);
  const dailyRecords = await attendanceCalendarRepository.listDailyRecordsForEmployees(ctx.companyId, employeeIds, fromDate, toDate);

  // employeeId -> workDate -> record — built once, so each cell lookup below is O(1), not a scan.
  const recordsByEmployee = new Map<string, Map<string, { status: AttendanceDailyStatus; workedMinutes: number | null }>>();
  for (const record of dailyRecords) {
    let byDate = recordsByEmployee.get(record.employeeId);
    if (!byDate) {
      byDate = new Map();
      recordsByEmployee.set(record.employeeId, byDate);
    }
    byDate.set(record.workDate, { status: record.status, workedMinutes: record.workedMinutes });
  }

  const rows: AttendanceCalendarRow[] = employeePage.map((employee) => {
    const byDate = recordsByEmployee.get(employee.id);
    const totals = emptyStatusCounts();
    const cells: AttendanceCalendarCell[] = days.map((date) => {
      const record = byDate?.get(date);
      if (!record) {
        return { date, status: "UNPROCESSED", workedMinutes: null, hasRecord: false };
      }
      totals[record.status] += 1;
      return { date, status: record.status, workedMinutes: record.workedMinutes, hasRecord: true };
    });
    return {
      employeeId: employee.id,
      employeeNumber: employee.employeeNumber,
      firstName: employee.firstName,
      lastName: employee.lastName,
      departmentName: employee.departmentName,
      locationName: employee.locationName,
      cells,
      totals,
    };
  });

  const dailyTotalsByDate = new Map<string, Record<AttendanceDailyStatus, number>>();
  for (const row of dailyTotalRows) {
    let counts = dailyTotalsByDate.get(row.workDate);
    if (!counts) {
      counts = emptyStatusCounts();
      dailyTotalsByDate.set(row.workDate, counts);
    }
    counts[row.status] = row.value;
  }
  const dailyTotals: AttendanceCalendarDailyTotal[] = days.map((date) => ({
    date,
    statusCounts: dailyTotalsByDate.get(date) ?? emptyStatusCounts(),
  }));

  const monthStatusCounts = emptyStatusCounts();
  for (const row of monthStatusRows) monthStatusCounts[row.status] = row.value;
  const processedEmployeeDays = Object.values(monthStatusCounts).reduce((sum, value) => sum + value, 0);
  const possibleEmployeeDays = totalEmployees * days.length;

  return {
    month,
    days,
    rows,
    dailyTotals,
    summary: {
      totalEmployees,
      possibleEmployeeDays,
      processedEmployeeDays,
      unprocessedEmployeeDays: Math.max(0, possibleEmployeeDays - processedEmployeeDays),
      statusCounts: monthStatusCounts,
    },
    pagination: { page, pageSize, total: totalEmployees, totalPages: Math.max(1, Math.ceil(totalEmployees / pageSize)) },
  };
}
