import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  let authenticated = false;
  try {
    await getRequestContext();
    authenticated = true;
  } catch {
    authenticated = false;
  }

  const { next } = await searchParams;
  if (authenticated) {
    redirect(next && next.startsWith("/") ? next : "/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Attendance & Workforce ERP</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your company workspace</p>
        </div>
        <Card>
          <CardContent className="pt-5">
            <LoginForm redirectTo={next && next.startsWith("/") ? next : "/dashboard"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
