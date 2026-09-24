import Link from "next/link";
import { cn } from "@/lib/utils";

const FILTERS: { value: string; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

/** Plain-link filter, same server-driven convention as the attendance dashboard's own filter
 *  bar/date selector — the backend remains the sole source of the filtered list. */
export function CorrectionsStatusFilter({ basePath, status }: { basePath: string; status: string }) {
  return (
    <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
      {FILTERS.map((filter) => (
        <Link
          key={filter.value}
          href={`${basePath}?status=${filter.value}`}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100",
            status === filter.value && "bg-blue-50 text-blue-700 hover:bg-blue-50",
          )}
        >
          {filter.label}
        </Link>
      ))}
    </div>
  );
}
