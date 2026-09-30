import Link from "next/link";
import { cn } from "@/lib/utils";
import { issuesTabHref, type IssuesTab } from "./issues-navigation";

const TAB_LABEL: Record<IssuesTab, string> = {
  all: "All",
  exceptions: "Exceptions",
  corrections: "Correction Requests",
};

/** Plain-link segmented control, same server-driven convention as `CorrectionsStatusFilter`. */
export function IssuesTabs({ tabs, active }: { tabs: IssuesTab[]; active: IssuesTab }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Issues and corrections" className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {tabs.map((tab) => (
        <Link
          key={tab}
          href={issuesTabHref(tab)}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100",
            tab === active && "bg-blue-50 text-blue-700 hover:bg-blue-50",
          )}
        >
          {TAB_LABEL[tab]}
        </Link>
      ))}
    </nav>
  );
}
