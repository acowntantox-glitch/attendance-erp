"use client";

import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Option = { id: string; name: string };

/**
 * Same server-driven GET-form convention as `DashboardFilterBar`/`ReportFilterBar` — every filter
 * change navigates to a new URL; nothing here filters an already-fetched list client-side.
 * `month` is preserved as a hidden field so applying/resetting filters never changes the selected
 * month (matching `DashboardFilterBar`'s own `date` hidden field).
 */
export function CalendarFilterBar({
  basePath,
  month,
  defaults,
  departments,
  locations,
}: {
  basePath: string;
  month: string;
  defaults: { search?: string; departmentId?: string; locationId?: string };
  departments: Option[];
  locations: Option[];
}) {
  function submitForm(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={basePath} method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="month" value={month} />

      <div className="min-w-[200px] flex-1">
        <Label htmlFor="calendar-search">Search</Label>
        <Input id="calendar-search" name="search" placeholder="Name or employee #" defaultValue={defaults.search} />
      </div>

      <FilterSelect name="departmentId" label="Department" defaultValue={defaults.departmentId} onSelect={submitForm} options={departments} allLabel="All departments" />
      <FilterSelect name="locationId" label="Location" defaultValue={defaults.locationId} onSelect={submitForm} options={locations} allLabel="All locations" />

      <button type="submit" className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Apply
      </button>
      <a href={`${basePath}?month=${month}`} className="flex h-10 items-center px-2 text-sm text-slate-500 underline-offset-2 hover:underline">
        Reset
      </a>
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
