import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendanceDashboard } from "@/domains/attendance/service";
import { listBranches, listDepartments } from "@/domains/organization/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { DateSelector } from "@/components/attendance/dashboard/date-selector";
import { ProcessDayButton } from "@/components/attendance/dashboard/process-day-button";
import { SummaryCards } from "@/components/attendance/dashboard/summary-cards";
import { CurrentlyWorkingTable } from "@/components/attendance/dashboard/currently-working-table";
import { LateArrivalsTable } from "@/components/attendance/dashboard/late-arrivals-table";
import { IncompleteAttendanceTable } from "@/components/attendance/dashboard/incomplete-attendance-table";
import { DashboardFilterBar } from "@/components/attendance/dashboard/dashboard-filter-bar";
import { AttendanceDashboardTable } from "@/components/attendance/dashboard/attendance-dashboard-table";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";

type SearchParams = {
  date?: string;
  page?: string;
  pageSize?: string;
  search?: string;
  departmentId?: string;
  locationId?: string;
  status?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * HR/Manager attendance dashboard — a read-only presentation layer over the Batch 1 Attendance
 * domain. EMPLOYEE already holds `attendance.view` for its own `/attendance` self-service page, so
 * that permission alone can't gate this route; EMPLOYEE is explicitly redirected here, and
 * `getAttendanceDashboard` independently rejects it server-side too (see service.ts) — the page
 * redirect is a UX nicety, not the actual enforcement boundary.
 */
export default async function AttendanceDashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  if (!can(ctx.role, "attendance.view")) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-slate-900">Attendance Dashboard</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            You don&apos;t have permission to view the attendance dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date && DATE_PATTERN.test(params.date) && params.date <= today ? params.date : today;

  const [result, departments, branches] = await Promise.all([
    getAttendanceDashboard(ctx, {
      workDate: date,
      page: Number(params.page ?? "1") || 1,
      pageSize: Number(params.pageSize ?? "25") || 25,
      search: params.search || undefined,
      departmentId: params.departmentId || undefined,
      locationId: params.locationId || undefined,
      status: (params.status as AttendanceDailyStatus) || undefined,
    }),
    listDepartments(ctx),
    listBranches(ctx),
  ]);

  const filterParams = { search: params.search, departmentId: params.departmentId, locationId: params.locationId, status: params.status };

  return (
    <div className="space-y-6">
      <DateSelector basePath="/attendance/dashboard" date={date} today={today} otherParams={filterParams} />

      <SummaryCards summary={result.summary} />

      {can(ctx.role, "attendance.recalculate") && <ProcessDayButton workDate={date} />}

      {date === today && (
        <Card>
          <CardHeader>
            <CardTitle>Currently Working</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CurrentlyWorkingTable rows={result.currentlyWorking} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Late Arrivals</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LateArrivalsTable rows={result.lateArrivals} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Incomplete Attendance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <IncompleteAttendanceTable rows={result.incompleteAttendance} />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Attendance</h2>
        <DashboardFilterBar
          basePath="/attendance/dashboard"
          date={date}
          defaults={{ search: params.search, status: params.status, departmentId: params.departmentId, locationId: params.locationId }}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          locations={branches.map((b) => ({ id: b.id, name: b.name }))}
        />
        <Card>
          <CardContent className="p-0">
            <AttendanceDashboardTable rows={result.table.items} />
          </CardContent>
        </Card>
        <Pagination
          page={result.table.page}
          pageSize={result.table.pageSize}
          total={result.table.total}
          basePath="/attendance/dashboard"
          searchParams={{ date, ...filterParams }}
        />
      </div>
    </div>
  );
}
