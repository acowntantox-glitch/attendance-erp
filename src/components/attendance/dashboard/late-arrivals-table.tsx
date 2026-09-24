import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LateArrivalRow } from "@/domains/attendance/model";
import { formatInstant, formatMinutesOrNull } from "../format";

/**
 * Sorted by `lateMinutes` descending (most significant first) — an operational triage order for
 * one day's list, not a cross-day ranking of individuals (see the "no evaluative ranking" rule).
 * `lateMinutes` is read as-is from the backend, never recomputed here.
 */
export function LateArrivalsTable({ rows }: { rows: LateArrivalRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-500">No late arrivals for this date.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Employee #</TableHead>
          <TableHead>Department</TableHead>
          <TableHead>Check In</TableHead>
          <TableHead>Schedule</TableHead>
          <TableHead>Shift</TableHead>
          <TableHead>Late</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/employees/${row.id}/attendance`} className="font-medium text-blue-700 hover:underline">
                {row.firstName} {row.lastName}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">{row.employeeNumber}</TableCell>
            <TableCell>{row.department?.name ?? "—"}</TableCell>
            <TableCell>{formatInstant(row.record.firstCheckInAt, row.timezone, "—")}</TableCell>
            <TableCell>{row.scheduleName ?? "—"}</TableCell>
            <TableCell>{row.shiftName ?? "—"}</TableCell>
            <TableCell className="font-medium text-amber-700">{formatMinutesOrNull(row.record.lateMinutes, "—")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
