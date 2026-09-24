import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendanceCalendar, shiftMonth } from "@/domains/attendance/calendar/attendance-calendar.service";
import { listBranches, listDepartments } from "@/domains/organization/service";
import { attendanceCalendarFiltersSchema } from "@/validations/attendance";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { CalendarMonthNav } from "@/components/attendance/calendar/calendar-month-nav";
import { CalendarFilterBar } from "@/components/attendance/calendar/calendar-filter-bar";
import { CalendarSummaryCards } from "@/components/attendance/calendar/calendar-summary-cards";
import { AttendanceCalendarMatrix } from "@/components/attendance/calendar/attendance-calendar-matrix";

type SearchParams = {
  month?: string;
  search?: string;
  departmentId?: string;
  locationId?: string;
  page?: string;
};

/**
 * HR-only monthly attendance matrix (Batch 7). Gated on `attendance.report.view` — the same
 * permission Batch 6's report already uses, reused as-is (no new permission — §3/§5 explicitly
 * call for this). Strictly a read-only presentation layer over `attendance_daily_records`; it
 * never triggers processing, corrections, or any attendance mutation.
 */
export default async function AttendanceCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  if (!can(ctx.role, "attendance.report.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance Calendar</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view the attendance calendar.
          </CardContent>
        </Card>
      </div>
    );
  }

  const params = await searchParams;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  const rawFilters = {
    month: params.month || currentMonth,
    search: params.search || undefined,
    departmentId: params.departmentId || undefined,
    locationId: params.locationId || undefined,
    page: params.page || undefined,
  };

  const parsed = attendanceCalendarFiltersSchema.safeParse(rawFilters);

  const [departments, branches] = await Promise.all([listDepartments(ctx), listBranches(ctx)]);
  const departmentOptions = departments.map((d) => ({ id: d.id, name: d.name }));
  const locationOptions = branches.map((b) => ({ id: b.id, name: b.name }));

  const filterBarDefaults = { search: rawFilters.search, departmentId: rawFilters.departmentId, locationId: rawFilters.locationId };

  if (!parsed.success) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Attendance Calendar</h1>
          <p className="text-sm text-slate-500">Monthly attendance matrix across your team.</p>
        </div>
        <Card>
          <CardContent className="py-6 text-center text-sm text-red-700">{parsed.error.issues[0]?.message ?? "Invalid filters."}</CardContent>
        </Card>
      </div>
    );
  }

  const { month, page, ...filters } = parsed.data;
  const result = await getAttendanceCalendar(ctx, month, filters, { page: page ?? 1, pageSize: 25 });

  const otherParams = { search: filters.search, departmentId: filters.departmentId, locationId: filters.locationId };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Attendance Calendar</h1>
        <p className="text-sm text-slate-500">Monthly attendance matrix across your team, derived from already-processed daily records.</p>
      </div>

      <CalendarMonthNav basePath="/attendance/calendar" month={month} prevMonth={shiftMonth(month, -1)} nextMonth={shiftMonth(month, 1)} otherParams={otherParams} />

      <CalendarFilterBar basePath="/attendance/calendar" month={month} defaults={filterBarDefaults} departments={departmentOptions} locations={locationOptions} />

      <CalendarSummaryCards summary={result.summary} />

      <Card>
        <CardContent className="p-0">
          <AttendanceCalendarMatrix result={result} today={today} />
        </CardContent>
        <Pagination
          page={result.pagination.page}
          pageSize={result.pagination.pageSize}
          total={result.pagination.total}
          basePath="/attendance/calendar"
          searchParams={{ month, ...otherParams }}
        />
      </Card>
    </div>
  );
}
