/**
 * Batch 6 — HR attendance reporting service. A thin orchestration layer over
 * `attendanceReportRepository`: parses nothing (validation happens in `validations/attendance.ts`
 * before this is called), enforces authorization, paginates, and builds the summary. It never
 * computes a worked/scheduled/late/overtime minute — every value here is read straight off
 * `attendance_daily_records` via the repository. The report page and the CSV export both call
 * this same module's functions with the same `AttendanceReportFilters` shape, so they can never
 * filter differently from each other (§27/§20).
 */
import { attendanceDailyStatusEnum } from "@/db/schema";
import type { RequestContext } from "@/lib/auth/request-context";
import { requirePermission } from "@/lib/auth/request-context";
import { BusinessRuleError } from "@/lib/errors";
import { buildCsv, neutralizeFormulaInjection } from "@/lib/csv";
import { attendanceReportRepository, type AttendanceReportFilters, type AttendanceReportRow } from "./attendance-report.repository";
import type { AttendanceDailyStatus } from "../model";

const ALL_DAILY_STATUSES = attendanceDailyStatusEnum.enumValues;

export const REPORT_MAX_PAGE_SIZE = 100;
export const REPORT_DEFAULT_PAGE_SIZE = 25;
/** §23 — no streaming infrastructure exists yet in this project, so a bounded row count is
 *  enforced instead: a clear, explicit rejection beats a silent truncation or an unbounded
 *  in-memory CSV build. */
export const REPORT_MAX_EXPORT_ROWS = 50_000;

export class AttendanceReportExportTooLargeError extends BusinessRuleError {
  constructor(rowCount: number, maxRows: number) {
    super(`This export would contain ${rowCount} rows, which exceeds the ${maxRows}-row export limit. Narrow the date range or filters and try again.`);
  }
}

export type AttendanceReportSummary = {
  statusCounts: Record<AttendanceDailyStatus, number>;
  totalScheduledMinutes: number;
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
};

export type AttendanceReportResult = {
  rows: AttendanceReportRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: AttendanceReportSummary;
};

async function buildSummary(companyId: string, filters: AttendanceReportFilters): Promise<AttendanceReportSummary> {
  const [statusRows, totals] = await Promise.all([
    attendanceReportRepository.getStatusCounts(companyId, filters),
    attendanceReportRepository.getMinutesTotals(companyId, filters),
  ]);
  const statusCounts = Object.fromEntries(ALL_DAILY_STATUSES.map((status) => [status, 0])) as Record<AttendanceDailyStatus, number>;
  for (const row of statusRows) statusCounts[row.status] = row.value;
  return { statusCounts, ...totals };
}

/**
 * §16 — the summary is always computed from the same filtered population as `rows`/`total` (two
 * dedicated aggregate queries over the identical `buildConditions`), never derived from the
 * current page, and never the global dashboard summary.
 */
export async function getAttendanceReport(
  ctx: RequestContext,
  filters: AttendanceReportFilters,
  pagination: { page: number; pageSize: number },
): Promise<AttendanceReportResult> {
  requirePermission(ctx, "attendance.report.view");

  const pageSize = Math.min(REPORT_MAX_PAGE_SIZE, Math.max(1, pagination.pageSize || REPORT_DEFAULT_PAGE_SIZE));
  const page = Math.max(1, pagination.page || 1);

  const [rows, total, summary] = await Promise.all([
    attendanceReportRepository.listRows(ctx.companyId, filters, { page, pageSize }),
    attendanceReportRepository.countRows(ctx.companyId, filters),
    buildSummary(ctx.companyId, filters),
  ]);

  return { rows, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, summary };
}

const CSV_HEADER = [
  "Employee Number",
  "Employee Name",
  "Department",
  "Location",
  "Date",
  "Status",
  "Scheduled Hours",
  "Worked Hours",
  "Late",
  "Early Leave",
  "Overtime",
];

const CSV_STATUS_LABEL: Record<AttendanceDailyStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  INCOMPLETE: "Incomplete",
  WEEKLY_OFF: "Weekly Off",
  HOLIDAY: "Holiday",
  WEEKLY_OFF_WORKED: "Worked on Weekly Off",
  HOLIDAY_WORKED: "Worked on Holiday",
  NO_SCHEDULE: "No Schedule",
};

/** "HH:MM", zero-padded, matching §21's example ("08:00", "09:35", "00:35"). `null` (an
 *  INCOMPLETE day's unknown worked/early/overtime minutes) becomes an empty field — never `0`,
 *  which would misrepresent "unknown" as "none" (§13). */
function formatMinutesAsClock(minutes: number | null): string {
  if (minutes === null) return "";
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function buildAttendanceReportCsv(rows: AttendanceReportRow[]): string {
  const body = rows.map((row) => [
    row.employeeNumber,
    neutralizeFormulaInjection(`${row.firstName} ${row.lastName}`),
    neutralizeFormulaInjection(row.departmentName ?? ""),
    neutralizeFormulaInjection(row.locationName ?? ""),
    row.workDate,
    CSV_STATUS_LABEL[row.status],
    formatMinutesAsClock(row.scheduledMinutes),
    formatMinutesAsClock(row.workedMinutes),
    formatMinutesAsClock(row.lateMinutes),
    formatMinutesAsClock(row.earlyDepartureMinutes),
    formatMinutesAsClock(row.overtimeMinutes),
  ]);
  return buildCsv(CSV_HEADER, body);
}

/**
 * Row count is checked *before* fetching (§23 — reject clearly, never silently truncate). Reuses
 * `attendanceReportRepository`'s exact same `AttendanceReportFilters` and ordering as
 * `getAttendanceReport` — there is no second filtering implementation to drift out of sync (§20/§27).
 */
/** Extracted purely so the boundary condition is unit-testable without needing 50,000+ real rows
 *  in a test database. */
export function assertExportRowLimit(total: number, maxRows: number = REPORT_MAX_EXPORT_ROWS): void {
  if (total > maxRows) {
    throw new AttendanceReportExportTooLargeError(total, maxRows);
  }
}

export async function exportAttendanceReportCsv(ctx: RequestContext, filters: AttendanceReportFilters): Promise<string> {
  requirePermission(ctx, "attendance.report.view");

  const total = await attendanceReportRepository.countRows(ctx.companyId, filters);
  assertExportRowLimit(total);

  const rows = await attendanceReportRepository.listAllRowsForExport(ctx.companyId, filters, REPORT_MAX_EXPORT_ROWS);
  return buildAttendanceReportCsv(rows);
}
