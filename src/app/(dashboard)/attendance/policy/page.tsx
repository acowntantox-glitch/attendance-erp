import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { getAttendancePolicy } from "@/domains/attendance/policy/attendance-policy.service";
import { Card, CardContent } from "@/components/ui/card";
import { AttendancePolicyPanel } from "@/components/attendance/policy/attendance-policy-panel";

/** Batch 12 — company attendance policy. The page-level gate is a UX nicety; `getAttendancePolicy`
 *  and `updateAttendancePolicy` each re-check their permission independently. */
export default async function AttendancePolicyPage() {
  const ctx = await getRequestContext();

  if (ctx.role === "EMPLOYEE") {
    redirect("/attendance");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Attendance Policy</h1>
        <p className="text-sm text-slate-500">
          Company-wide rules applied when attendance is calculated. Shift and schedule hours, breaks, weekly offs and holidays are managed in
          Workforce.
        </p>
      </div>

      {!can(ctx.role, "attendance.policy.view") ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">You don&apos;t have permission to view the attendance policy.</CardContent>
        </Card>
      ) : (
        <AttendancePolicyPanel policy={await getAttendancePolicy(ctx)} canManage={can(ctx.role, "attendance.policy.update")} />
      )}
    </div>
  );
}
