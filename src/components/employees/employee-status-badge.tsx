import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { EmploymentStatus } from "@/domains/employee/model";

const STATUS_VARIANT: Record<EmploymentStatus, NonNullable<BadgeProps["variant"]>> = {
  ACTIVE: "success",
  PROBATION: "warning",
  ON_LEAVE: "info",
  NOTICE_PERIOD: "warning",
  SUSPENDED: "danger",
  RESIGNED: "neutral",
  TERMINATED: "danger",
  INACTIVE: "neutral",
};

export function EmployeeStatusBadge({ status }: { status: EmploymentStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status.replaceAll("_", " ")}</Badge>;
}
