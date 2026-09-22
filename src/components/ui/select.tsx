"use client";

import * as RadixSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small inline icons instead of pulling in an icon library for two glyphs.
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const Select = RadixSelect.Root;
export const SelectValue = RadixSelect.Value;

export function SelectTrigger({ className, children, ...props }: RadixSelect.SelectTriggerProps) {
  return (
    <RadixSelect.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 disabled:opacity-50 data-[placeholder]:text-slate-400",
        className,
      )}
      {...props}
    >
      {children}
      <RadixSelect.Icon>
        <ChevronDownIcon />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectContent({ children }: { children: ReactNode }) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        className="z-50 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        position="popper"
        sideOffset={4}
      >
        <RadixSelect.Viewport className="max-h-64 p-1">{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectItem({ className, children, ...props }: RadixSelect.SelectItemProps) {
  return (
    <RadixSelect.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-8 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-800",
        className,
      )}
      {...props}
    >
      <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center">
        <CheckIcon />
      </RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
