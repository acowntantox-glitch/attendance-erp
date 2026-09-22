import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/request-context";
import { getMyCompany } from "@/domains/organization/service";
import { userRepository } from "@/domains/auth/repository";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/topnav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getRequestContext();
  } catch {
    redirect("/login");
  }

  const [company, user] = await Promise.all([getMyCompany(ctx), userRepository.findById(ctx.userId)]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar role={ctx.role} />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopNav companyName={company.name} fullName={user?.fullName ?? ctx.userEmail} role={ctx.role} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
