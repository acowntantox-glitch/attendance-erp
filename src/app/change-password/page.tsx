import { redirect } from "next/navigation";
import { getRequestContextAllowingPasswordChange } from "@/lib/auth/request-context";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The page an account is sent to when an administrator has reset its password: until the user picks
 * their own, `getRequestContext()` refuses every other page and API. Deliberately outside the
 * dashboard layout (no navigation to click away to), and it needs a valid session.
 */
export default async function ChangePasswordPage() {
  try {
    await getRequestContextAllowingPasswordChange();
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
          <p className="mt-1 text-sm text-slate-500">
            An administrator reset your password. Enter the temporary password you were given, then choose your own.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <ChangePasswordForm forced />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
