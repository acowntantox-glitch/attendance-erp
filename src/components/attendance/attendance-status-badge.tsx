import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";
import { STATUS_LABEL } from "./format";

const STATUS_VARIANT: Record<AttendanceDailyStatus, NonNullable<BadgeProps["variant"]>> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "danger",
  INCOMPLETE: "warning",
  WEEKLY_OFF: "neutral",
  HOLIDAY: "neutral",
  WEEKLY_OFF_WORKED: "info",
  HOLIDAY_WORKED: "info",
  NO_SCHEDULE: "neutral",
};

/** Color is never the only signal — the label text always states the status in words too. */
export function AttendanceStatusBadge({ status }: { status: AttendanceDailyStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
