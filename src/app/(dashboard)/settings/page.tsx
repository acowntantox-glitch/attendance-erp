import { getRequestContext } from "@/lib/auth/request-context";
import { can } from "@/lib/auth/rbac";
import { listCompanyUsers } from "@/domains/auth/user-management.service";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { UsersPanel } from "@/components/settings/users-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Settings: every signed-in user can change their own password; the "Users & Access" section is
 * rendered only for holders of `user.manage`. The page-level check is a convenience — `listCompanyUsers`
 * and every mutation re-check the permission and the company on the server.
 */
export default async function SettingsPage() {
  const ctx = await getRequestContext();
  const canManageUsers = can(ctx.role, "user.manage");
  const users = canManageUsers ? await listCompanyUsers(ctx) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Your account{canManageUsers ? " and who can sign in to this company" : ""}.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      {users && <UsersPanel users={users} />}
    </div>
  );
}
