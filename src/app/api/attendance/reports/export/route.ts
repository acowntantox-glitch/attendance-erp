import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { attendanceReportFiltersSchema } from "@/validations/attendance";
import { exportAttendanceReportCsv } from "@/domains/attendance/reports/attendance-report.service";

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = attendanceReportFiltersSchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError("Invalid report filters.", parsed.error.flatten());
  }

  const { page: _page, pageSize: _pageSize, ...filters } = parsed.data;
  const csv = await exportAttendanceReportCsv(ctx, filters);

  // Dates only — never an internal id — in the download filename (§26).
  const filename = `attendance-report-${filters.fromDate}-to-${filters.toDate}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
