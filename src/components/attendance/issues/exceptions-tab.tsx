import type { RequestContext } from "@/lib/auth/request-context";
import { listAttendanceExceptions } from "@/domains/attendance/exceptions/attendance-exception.service";
import { getMyCompany, listBranches, listDepartments } from "@/domains/organization/service";
import { attendanceExceptionFiltersSchema } from "@/validations/attendance";
import { addDays } from "@/lib/datetime";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { ExceptionFilterBar } from "@/components/attendance/exceptions/exception-filter-bar";
import { ExceptionSummaryCards } from "@/components/attendance/exceptions/exception-summary-cards";
import { ExceptionsTable } from "@/components/attendance/exceptions/exceptions-table";
import { ISSUES_BASE_PATH } from "./issues-navigation";

export type ExceptionsTabParams = {
  fromDate?: string;
  toDate?: string;
  types?: string | string[];
  departmentId?: string;
  locationId?: string;
  search?: string;
  includeDismissed?: string;
  page?: string;
};

const EXTRA_PARAMS = { tab: "exceptions" };

/**
 * The "Exceptions" tab: the unchanged Batch 10 exception queue (filters, summary cards, table,
 * dismiss/undismiss, pagination), moved here from the old `/attendance/exceptions` page. All data
 * still comes from `listAttendanceExceptions`, which re-checks `attendance.report.view` itself —
 * the caller has already decided this tab is available, but that is UX, not the security boundary.
 */
export async function ExceptionsTab({ ctx, params }: { ctx: RequestContext; params: ExceptionsTabParams }) {
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

  const description = (
    <p className="text-sm text-slate-500">
      Attendance problems detected by the system — late arrivals, incomplete days, absences, and early departures.
    </p>
  );

  if (!parsed.success) {
    return (
      <div className="space-y-4">
        {description}
        <ExceptionFilterBar
          basePath={ISSUES_BASE_PATH}
          extraParams={EXTRA_PARAMS}
          defaults={filterBarDefaults}
          departments={departmentOptions}
          locations={locationOptions}
        />
        <Card>
          <CardContent className="py-6 text-center text-sm text-red-700">{parsed.error.issues[0]?.message ?? "Invalid filters."}</CardContent>
        </Card>
      </div>
    );
  }

  const { page, ...filters } = parsed.data;
  const result = await listAttendanceExceptions(ctx, filters, { page: page ?? 1, pageSize: 25 });

  const paginationSearchParams = {
    ...EXTRA_PARAMS,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    types: filters.types?.join(","),
    departmentId: filters.departmentId,
    locationId: filters.locationId,
    search: filters.search,
    includeDismissed: filters.includeDismissed ? "true" : undefined,
  };

  return (
    <div className="space-y-4">
      {description}

      <ExceptionFilterBar
        basePath={ISSUES_BASE_PATH}
        extraParams={EXTRA_PARAMS}
        defaults={filterBarDefaults}
        departments={departmentOptions}
        locations={locationOptions}
      />

      <ExceptionSummaryCards summary={result.summary} />

      <Card>
        <CardContent className="p-0">
          <ExceptionsTable items={result.items} timezone={company.timezone} />
        </CardContent>
        <Pagination
          page={result.pagination.page}
          pageSize={result.pagination.pageSize}
          total={result.pagination.total}
          basePath={ISSUES_BASE_PATH}
          searchParams={paginationSearchParams}
        />
      </Card>
    </div>
  );
}
