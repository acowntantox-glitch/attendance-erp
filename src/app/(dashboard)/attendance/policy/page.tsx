import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendancePolicy } from "@/domains/attendance/policy/attendance-policy.service";
import { Card, CardContent } from "@/components/ui/card";
import { AttendancePolicyPanel } from "@/components/attendance/policy/attendance-policy-panel";
import { PageHeader } from "@/components/ui/page-header";

/** Batch 12 — company attendance policy. The page-level gate is a UX nicety; `getAttendancePolicy`
 *  and `updateAttendancePolicy` each re-check their permission independently. */
export default async function AttendancePolicyPage() {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Policy"
        description="Company-wide rules applied when attendance is calculated. Shift and schedule hours, breaks, weekly offs and holidays are managed in Workforce."
      />

      {!can(ctx.role, "attendance.policy.view") ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-slate-700">You don&apos;t have permission to view the attendance policy.</p>
            <p className="mt-1 text-xs text-slate-500">Contact your administrator if you need access.</p>
          </CardContent>
        </Card>
      ) : (
        <AttendancePolicyPanel policy={await getAttendancePolicy(ctx)} canManage={can(ctx.role, "attendance.policy.update")} />
      )}
    </div>
  );
}
