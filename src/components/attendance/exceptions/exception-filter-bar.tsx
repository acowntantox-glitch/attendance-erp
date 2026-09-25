"use client";

import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Option = { id: string; name: string };
type ExceptionType = "LATE" | "INCOMPLETE" | "ABSENT" | "EARLY_DEPARTURE";

const TYPE_OPTIONS: { value: ExceptionType; label: string }[] = [
  { value: "LATE", label: "Late" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "ABSENT", label: "Absent" },
  { value: "EARLY_DEPARTURE", label: "Early Departure" },
];

/**
 * Same server-driven GET-form convention as `CalendarFilterBar`/`DashboardFilterBar` — every
 * filter change navigates to a new URL; nothing here filters an already-fetched page client-side
 * (pagination/dismissal counts would silently disagree with the table otherwise). `types` uses
 * repeated `<input name="types">` checkboxes, Next.js's native repeated-query-key array — not a
 * hand-built comma-separated value.
 */
export function ExceptionFilterBar({
  basePath,
  defaults,
  departments,
  locations,
}: {
  basePath: string;
  defaults: {
    fromDate: string;
    toDate: string;
    types: ExceptionType[];
    departmentId?: string;
    locationId?: string;
    search?: string;
    includeDismissed: boolean;
  };
  departments: Option[];
  locations: Option[];
}) {
  function submitForm(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={basePath} method="GET" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="exc-from">From</Label>
          <Input id="exc-from" type="date" name="fromDate" defaultValue={defaults.fromDate} max={defaults.toDate} />
        </div>
        <div>
          <Label htmlFor="exc-to">To</Label>
          <Input id="exc-to" type="date" name="toDate" defaultValue={defaults.toDate} min={defaults.fromDate} />
        </div>
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="exc-search">Search</Label>
          <Input id="exc-search" name="search" placeholder="Name or employee #" defaultValue={defaults.search} />
        </div>
        <FilterSelect name="departmentId" label="Department" defaultValue={defaults.departmentId} onSelect={submitForm} options={departments} allLabel="All departments" />
        <FilterSelect name="locationId" label="Location" defaultValue={defaults.locationId} onSelect={submitForm} options={locations} allLabel="All locations" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Type</span>
        {TYPE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" name="types" value={option.value} defaultChecked={defaults.types.length === 0 || defaults.types.includes(option.value)} className="h-4 w-4 rounded border-slate-300" />
            {option.label}
          </label>
        ))}
        <label className="ml-4 flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" name="includeDismissed" value="true" defaultChecked={defaults.includeDismissed} className="h-4 w-4 rounded border-slate-300" />
          Show dismissed
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Apply
        </button>
        <a href={basePath} className="flex h-10 items-center px-2 text-sm text-slate-500 underline-offset-2 hover:underline">
          Reset
        </a>
      </div>
    </form>
  );
}

function FilterSelect({
  name,
  label,
  defaultValue,
  options,
  onSelect,
  allLabel,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: Option[];
  onSelect: (event: ChangeEvent<HTMLSelectElement>) => void;
  allLabel: string;
}) {
  return (
    <div className="min-w-[170px]">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        onChange={onSelect}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
