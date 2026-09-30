import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AttendanceProcessingRun } from "@/domains/attendance/processing/attendance-processing.repository";
import { formatDateLabel, formatInstantWithDate } from "../format";

const STATUS_VARIANT: Record<AttendanceProcessingRun["status"], NonNullable<BadgeProps["variant"]>> = {
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
};

const STATUS_LABEL: Record<AttendanceProcessingRun["status"], string> = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const TRIGGER_LABEL: Record<AttendanceProcessingRun["trigger"], string> = {
  SCHEDULED: "Scheduled",
  MANUAL: "Manual",
};

function formatDuration(run: AttendanceProcessingRun): string {
  if (!run.finishedAt) return "—";
  const seconds = Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Read-only view of the automated "materialize missing daily records" job's recent runs
 *  (Batch 13). Times are shown in the company's timezone. */
export function RecentProcessingRuns({ runs, timezone }: { runs: AttendanceProcessingRun[]; timezone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Processing Runs</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {runs.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No automated processing runs yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Work Date</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Skipped</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} title={run.message ?? undefined}>
                  <TableCell>{formatDateLabel(run.workDate)}</TableCell>
                  <TableCell>{TRIGGER_LABEL[run.trigger]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[run.status]}>{STATUS_LABEL[run.status]}</Badge>
                  </TableCell>
                  <TableCell>{run.createdCount}</TableCell>
                  <TableCell>{run.skippedCount}</TableCell>
                  <TableCell>{run.failedCount}</TableCell>
                  <TableCell>{formatInstantWithDate(run.startedAt, timezone, "—")}</TableCell>
                  <TableCell>{formatInstantWithDate(run.finishedAt, timezone, "—")}</TableCell>
                  <TableCell>{formatDuration(run)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
