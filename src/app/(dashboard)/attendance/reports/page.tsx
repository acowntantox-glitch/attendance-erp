import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendanceReport } from "@/domains/attendance/reports/attendance-report.service";
import { listActiveEmployeesForDropdown } from "@/domains/employee/service";
import { listBranches, listDepartments } from "@/domains/organization/service";
import { attendanceReportFiltersSchema } from "@/validations/attendance";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { ReportFilterBar } from "@/components/attendance/reports/report-filter-bar";
import { ReportSummaryCards } from "@/components/attendance/reports/report-summary-cards";
import { AttendanceReportTable } from "@/components/attendance/reports/attendance-report-table";
import { ExportCsvButton } from "@/components/attendance/reports/export-csv-button";

type SearchParams = {
  fromDate?: string;
  toDate?: string;
  employeeId?: string;
  departmentId?: string;
  locationId?: string;
  status?: string;
  search?: string;
  page?: string;
};

function firstDayOfMonth(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/**
 * HR-only attendance report (Batch 6). Gated on `attendance.report.view` — a new, dedicated
 * permission (see rbac.ts): every existing attendance permission either excludes HR_MANAGER
 * (correction.approve-style) or, more importantly, already includes MANAGER (`report.read`,
 * `attendance.view`), which this batch explicitly says must NOT gain company-wide report access.
 * EMPLOYEE is redirected before the permission check even runs, matching every other
 * HR-attendance page's convention (dashboard, corrections queue).
 */
export default async function AttendanceReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  if (!can(ctx.role, "attendance.report.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance Reports</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view attendance reports.
          </CardContent>
        </Card>
      </div>
    );
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const rawFilters = {
    fromDate: params.fromDate || firstDayOfMonth(today),
    toDate: params.toDate || today,
    employeeId: params.employeeId || undefined,
    departmentId: params.departmentId || undefined,
    locationId: params.locationId || undefined,
    status: params.status || undefined,
    search: params.search || undefined,
    page: params.page || undefined,
  };

  const parsed = attendanceReportFiltersSchema.safeParse(rawFilters);

  const [departments, branches, employees] = await Promise.all([
    listDepartments(ctx),
    listBranches(ctx),
    listActiveEmployeesForDropdown(ctx),
  ]);

  const filterBarDefaults = {
    fromDate: rawFilters.fromDate,
    toDate: rawFilters.toDate,
    employeeId: rawFilters.employeeId,
    departmentId: rawFilters.departmentId,
    locationId: rawFilters.locationId,
    status: rawFilters.status,
    search: rawFilters.search,
  };
  const employeeOptions = employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName} (${e.employeeNumber})` }));
  const departmentOptions = departments.map((d) => ({ id: d.id, name: d.name }));
  const locationOptions = branches.map((b) => ({ id: b.id, name: b.name }));

  if (!parsed.success) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Attendance Reports</h1>
          <p className="text-sm text-slate-500">Review and export daily attendance records for a date range.</p>
        </div>
        <ReportFilterBar basePath="/attendance/reports" defaults={filterBarDefaults} employees={employeeOptions} departments={departmentOptions} locations={locationOptions} />
        <Card>
          <CardContent className="py-6 text-center text-sm text-red-700">
            {parsed.error.issues[0]?.message ?? "Invalid filters."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { page, ...filters } = parsed.data;
  const result = await getAttendanceReport(ctx, filters, { page: page ?? 1, pageSize: 25 });

  const exportFilters = {
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    employeeId: filters.employeeId,
    departmentId: filters.departmentId,
    locationId: filters.locationId,
    status: filters.status,
    search: filters.search,
  };

  // Cheap, reliable-only case (§19): unfiltered single-day view where the row count is directly
  // comparable to the active headcount. Multi-day ranges or any active filter are skipped rather
  // than guessed at.
  const isUnfilteredSingleDay =
    filters.fromDate === filters.toDate &&
    !filters.employeeId &&
    !filters.departmentId &&
    !filters.locationId &&
    !filters.status &&
    !filters.search;
  const showUncomputedNote = isUnfilteredSingleDay && result.pagination.total < employees.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Attendance Reports</h1>
          <p className="text-sm text-slate-500">Review and export daily attendance records for a date range.</p>
        </div>
        <ExportCsvButton filters={exportFilters} />
      </div>

      <ReportFilterBar basePath="/attendance/reports" defaults={filterBarDefaults} employees={employeeOptions} departments={departmentOptions} locations={locationOptions} />

      {showUncomputedNote && (
        <p className="text-xs text-slate-400">
          Some employees have no processed attendance record for this date yet. Run Process Day from the Attendance Dashboard.
        </p>
      )}

      <ReportSummaryCards summary={result.summary} />

      <Card>
        <CardContent className="p-0">
          <AttendanceReportTable rows={result.rows} />
        </CardContent>
        <Pagination
          page={result.pagination.page}
          pageSize={result.pagination.pageSize}
          total={result.pagination.total}
          basePath="/attendance/reports"
          searchParams={{ ...filterBarDefaults }}
        />
      </Card>
    </div>
  );
}
