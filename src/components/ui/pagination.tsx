import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Link-based, not client-state-based: the employee directory is a server component that reads
 * `page`/`pageSize`/filters from the URL, so pagination navigates via real links (bookmarkable,
 * shareable, no client JS required) rather than local state.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);

  function hrefFor(targetPage: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  const from = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const to = Math.min(clampedPage * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <PageLink href={hrefFor(clampedPage - 1)} disabled={clampedPage <= 1}>
          Previous
        </PageLink>
        <span className="px-2">
          Page {clampedPage} of {totalPages}
        </span>
        <PageLink href={hrefFor(clampedPage + 1)} disabled={clampedPage >= totalPages}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-slate-300">{children}</span>;
  }
  return (
    <Link
      href={href}
      className={cn("rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50")}
    >
      {children}
    </Link>
  );
}
