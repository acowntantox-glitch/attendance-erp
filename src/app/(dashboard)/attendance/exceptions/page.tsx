import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listAttendanceExceptions } from "@/domains/attendance/exceptions/attendance-exception.service";
import { getMyCompany, listBranches, listDepartments } from "@/domains/organization/service";
import { attendanceExceptionFiltersSchema } from "@/validations/attendance";
import { addDays } from "@/lib/datetime";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { ExceptionFilterBar } from "@/components/attendance/exceptions/exception-filter-bar";
import { ExceptionSummaryCards } from "@/components/attendance/exceptions/exception-summary-cards";
import { ExceptionsTable } from "@/components/attendance/exceptions/exceptions-table";

type SearchParams = {
  fromDate?: string;
  toDate?: string;
  types?: string | string[];
  departmentId?: string;
  locationId?: string;
  search?: string;
  includeDismissed?: string;
  page?: string;
};

/**
 * HR-only attendance exception queue (Batch 10). Gated on `attendance.report.view` — the same
 * permission the calendar/reports pages already use, matching the batch's own instruction to
 * reuse the report-management capability rather than invent a new view permission. MANAGER holds
 * `attendance.view` but not `attendance.report.view`, so it's excluded from this page exactly the
 * way it's already excluded from Reports/Calendar — no new rule, no manager-hierarchy logic.
 */
export default async function AttendanceExceptionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  if (!can(ctx.role, "attendance.report.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance Exceptions</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view attendance exceptions.
          </CardContent>
        </Card>
      </div>
    );
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);

  const rawFilters = {
    fromDate: params.fromDate || addDays(today, -6),
    toDate: params.toDate || today,
    types: params.types,
    departmentId: params.departmentId || undefined,
    locationId: params.locationId || undefined,
    search: params.search || undefined,
    includeDismissed: params.includeDismissed || undefined,
    page: params.page || undefined,
  };

  const parsed = attendanceExceptionFiltersSchema.safeParse(rawFilters);

  const [departments, branches, company] = await Promise.all([listDepartments(ctx), listBranches(ctx), getMyCompany(ctx)]);
  const departmentOptions = departments.map((d) => ({ id: d.id, name: d.name }));
  const locationOptions = branches.map((b) => ({ id: b.id, name: b.name }));

  const filterBarDefaults = {
    fromDate: rawFilters.fromDate,
    toDate: rawFilters.toDate,
    types: parsed.success ? (parsed.data.types ?? []) : [],
    departmentId: rawFilters.departmentId,
    locationId: rawFilters.locationId,
    search: rawFilters.search,
    includeDismissed: parsed.success ? (parsed.data.includeDismissed ?? false) : false,
  };

  if (!parsed.success) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Attendance Exceptions</h1>
          <p className="text-sm text-slate-500">Detected attendance issues over a date range — late arrivals, incomplete days, absences, and early departures.</p>
        </div>
        <ExceptionFilterBar basePath="/attendance/exceptions" defaults={filterBarDefaults} departments={departmentOptions} locations={locationOptions} />
        <Card>
          <CardContent className="py-6 text-center text-sm text-red-700">{parsed.error.issues[0]?.message ?? "Invalid filters."}</CardContent>
        </Card>
      </div>
    );
  }

  const { page, ...filters } = parsed.data;
  const result = await listAttendanceExceptions(ctx, filters, { page: page ?? 1, pageSize: 25 });

  const paginationSearchParams = {
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    types: filters.types?.join(","),
    departmentId: filters.departmentId,
    locationId: filters.locationId,
    search: filters.search,
    includeDismissed: filters.includeDismissed ? "true" : undefined,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Attendance Exceptions</h1>
        <p className="text-sm text-slate-500">Detected attendance issues over a date range — late arrivals, incomplete days, absences, and early departures.</p>
      </div>

      <ExceptionFilterBar basePath="/attendance/exceptions" defaults={filterBarDefaults} departments={departmentOptions} locations={locationOptions} />

      <ExceptionSummaryCards summary={result.summary} />

      <Card>
        <CardContent className="p-0">
          <ExceptionsTable items={result.items} timezone={company.timezone} />
        </CardContent>
        <Pagination
          page={result.pagination.page}
          pageSize={result.pagination.pageSize}
          total={result.pagination.total}
          basePath="/attendance/exceptions"
          searchParams={paginationSearchParams}
        />
      </Card>
    </div>
  );
}
