import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Title block for a page: an `h1`, an optional one-paragraph description and an optional actions
 * slot on the right (it wraps below the title on narrow screens). Server component — no state, no
 * hooks — so it renders the same in pages, permission-denied branches and error boundaries.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
