import { cn } from "@/lib/utils";

/**
 * Shared look of the Attendance navigation rows. Plain module (no "use client") so both the client
 * module bar and the server-rendered Issues tabs can use it.
 *
 * Two tiers: `primary` (the module bar) is a bordered container with a stronger active state;
 * `secondary` (Settings pages, Issues views) is a quieter row with no container. Both keep the same
 * active recipe — `bg-blue-50 text-blue-700 font-semibold` plus a 2px bar under the label — so the
 * active tab is identifiable without colour. The bar is an absolutely positioned pseudo-element and
 * the bold width is reserved on every label (see `TabLabel`), so switching tabs moves nothing.
 */
export type TabTier = "primary" | "secondary";

export function tabListClass(tier: TabTier): string {
  return tier === "primary"
    ? "flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1"
    : "flex gap-0.5 overflow-x-auto p-1";
}

export function tabLinkClass(tier: TabTier, active: boolean): string {
  return cn(
    "relative shrink-0 whitespace-nowrap rounded-md text-sm",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1",
    tier === "primary" ? "px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900" : "px-2.5 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800",
    active &&
      "bg-blue-50 font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-700 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-700",
  );
}

/** The label with its semibold width reserved by an invisible copy, so activating a tab never
 *  changes its (or its neighbours') width. */
export function TabLabel({ children }: { children: string }) {
  return (
    <span
      data-label={children}
      className="flex flex-col items-center before:invisible before:block before:h-0 before:overflow-hidden before:font-semibold before:content-[attr(data-label)]"
    >
      {children}
    </span>
  );
}
