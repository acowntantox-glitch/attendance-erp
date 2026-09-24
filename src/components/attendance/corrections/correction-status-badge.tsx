import { Badge, type BadgeProps } from "@/components/ui/badge";

type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";

const STATUS_LABEL: Record<CorrectionStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const STATUS_VARIANT: Record<CorrectionStatus, NonNullable<BadgeProps["variant"]>> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

export function CorrectionStatusBadge({ status }: { status: CorrectionStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
