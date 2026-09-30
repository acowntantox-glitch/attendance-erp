import Link from "next/link";
import type { RequestContext } from "@/lib/auth/request-context";
import { listAttendanceExceptions } from "@/domains/attendance/exceptions/attendance-exception.service";
import { listCompanyCorrections } from "@/domains/attendance/service";
import { getMyCompany } from "@/domains/organization/service";
import { addDays } from "@/lib/datetime";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CorrectionStatusBadge } from "@/components/attendance/corrections/correction-status-badge";
import { TYPE_LABEL, detailFor } from "@/components/attendance/exceptions/exceptions-table";
import { CORRECTION_FIELD_LABEL, formatDateLabel, formatInstantWithDate } from "../format";
import { issuesTabHref } from "./issues-navigation";

const ROWS_PER_SOURCE = 10;
const LOOKBACK_DAYS = 7;

type OverviewRow = {
  key: string;
  employee: string;
  workDate: string;
  type: string;
  description: string;
  status: "OPEN" | "PENDING";
  href: string;
  order: number;
};

/**
 * The "All" tab: a compact, read-only combined worklist. It is a UI-level projection only — the
 * latest open exceptions (last 7 days, dismissed hidden) and the pending correction requests are
 * loaded through their own existing services, mapped to one row shape, and merged by date. There is
 * no aggregation backend, no new query, and no action here: each row links to the tab that owns the
 * real workflow (dismiss, approve, reject). Only types the system already produces are shown.
 */
export async function IssuesOverviewTab({ ctx }: { ctx: RequestContext }) {
  const today = new Date().toISOString().slice(0, 10);
  const [exceptions, corrections, company] = await Promise.all([
    listAttendanceExceptions(ctx, { fromDate: addDays(today, -(LOOKBACK_DAYS - 1)), toDate: today }, { page: 1, pageSize: ROWS_PER_SOURCE }),
    listCompanyCorrections(ctx, "PENDING"),
    getMyCompany(ctx),
  ]);

  const rows: OverviewRow[] = [
    ...exceptions.items.map(
      (item): OverviewRow => ({
        key: `exception-${item.employeeId}-${item.workDate}-${item.exceptionType}`,
        employee: `${item.firstName} ${item.lastName}`,
        workDate: item.workDate,
        type: TYPE_LABEL[item.exceptionType],
        description: detailFor(item),
        status: "OPEN",
        href: issuesTabHref("exceptions"),
        order: 0,
      }),
    ),
    ...corrections.slice(0, ROWS_PER_SOURCE).map(
      (correction): OverviewRow => ({
        key: `correction-${correction.id}`,
        employee: `${correction.employee.firstName} ${correction.employee.lastName}`,
        workDate: correction.workDate,
        type: "Correction request",
        description: `${CORRECTION_FIELD_LABEL[correction.fieldChanged]} → ${formatInstantWithDate(correction.correctedValue, company.timezone)}`,
        status: "PENDING",
        href: issuesTabHref("corrections"),
        order: 1,
      }),
    ),
  ].sort((a, b) => (a.workDate === b.workDate ? a.order - b.order : a.workDate < b.workDate ? 1 : -1));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Everything that needs attention in one list: attendance problems detected by the system and requests to correct attendance records.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link href={issuesTabHref("exceptions")}>
          <Card>
            <CardHeader>
              <CardTitle>Exceptions (last {LOOKBACK_DAYS} days)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{exceptions.pagination.total}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href={issuesTabHref("corrections", { status: "PENDING" })}>
          <Card>
            <CardHeader>
              <CardTitle>Pending correction requests</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{corrections.length}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">No open issues found.</p>
              <p className="mt-1 text-xs text-slate-500">Nothing needs review right now.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium text-slate-900">{row.employee}</TableCell>
                    <TableCell>{formatDateLabel(row.workDate)}</TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>{row.description}</TableCell>
                    <TableCell>{row.status === "PENDING" ? <CorrectionStatusBadge status="PENDING" /> : <Badge variant="warning">Open</Badge>}</TableCell>
                    <TableCell>
                      <Link href={row.href} className="text-sm text-blue-700 hover:underline">
                        Review →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(exceptions.pagination.total > ROWS_PER_SOURCE || corrections.length > ROWS_PER_SOURCE) && (
        <p className="text-xs text-slate-500">
          Showing the latest {ROWS_PER_SOURCE} of each. Open the Exceptions or Correction Requests tab for the full lists and filters.
        </p>
      )}
    </div>
  );
}
