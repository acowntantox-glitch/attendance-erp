import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { getMyEmployeeRecord } from "@/domains/employee/service";
import { EmployeeNotFoundError } from "@/domains/employee/errors";
import { Card, CardContent } from "@/components/ui/card";

/** Self-service entry point for roles without `employee.view` (see sidebar.tsx) — resolves the
 *  logged-in user's own employee record via `ctx.userId` and forwards to the normal profile
 *  page, which already grants full access to your own record regardless of that permission. */
export default async function MyProfilePage() {
  const ctx = await getRequestContext();

  try {
    const employee = await getMyEmployeeRecord(ctx);
    redirect(`/employees/${employee.id}`);
  } catch (error) {
    if (error instanceof EmployeeNotFoundError) {
      return (
        <div className="space-y-6">
          <h1 className="text-lg font-semibold text-slate-900">My Profile</h1>
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-400">
              No employee record is linked to your account yet. Ask HR to link your login to your employee profile.
            </CardContent>
          </Card>
        </div>
      );
    }
    throw error;
  }
}
