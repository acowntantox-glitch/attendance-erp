import { UserMenu } from "./user-menu";

export function TopNav({
  companyName,
  fullName,
  role,
}: {
  companyName: string;
  fullName: string;
  role: string;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
      <span className="text-sm font-medium text-slate-500">{companyName}</span>
      <UserMenu fullName={fullName} role={role} />
    </header>
  );
}
