"use client";

import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_LABEL } from "../format";
import type { AttendanceDailyStatus } from "@/domains/attendance/model";

type Option = { id: string; name: string };

const STATUS_OPTIONS: Option[] = (Object.keys(STATUS_LABEL) as AttendanceDailyStatus[]).map((status) => ({
  id: status,
  name: STATUS_LABEL[status],
}));

/**
 * A plain GET form, same convention as `EmployeeFilterBar`: every filter change navigates to a
 * new URL, so the dashboard page stays server-rendered and the backend remains the sole source of
 * the filtered/searched/paginated result — no client-side filtering of an already-fetched list.
 * `date` is preserved as a hidden field so changing a filter never resets the selected day.
 */
export function DashboardFilterBar({
  basePath,
  date,
  defaults,
  departments,
  locations,
}: {
  basePath: string;
  date: string;
  defaults: { search?: string; status?: string; departmentId?: string; locationId?: string };
  departments: Option[];
  locations: Option[];
}) {
  function submitForm(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={basePath} method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="date" value={date} />

      <div className="min-w-[200px] flex-1">
        <Label htmlFor="dashboard-search">Search</Label>
        <Input id="dashboard-search" name="search" placeholder="Name or employee #" defaultValue={defaults.search} />
      </div>

      <FilterSelect
        name="status"
        label="Status"
        defaultValue={defaults.status}
        onSelect={submitForm}
        options={STATUS_OPTIONS}
        allLabel="All statuses"
      />
      <FilterSelect
        name="departmentId"
        label="Department"
        defaultValue={defaults.departmentId}
        onSelect={submitForm}
        options={departments}
        allLabel="All departments"
      />
      <FilterSelect
        name="locationId"
        label="Branch"
        defaultValue={defaults.locationId}
        onSelect={submitForm}
        options={locations}
        allLabel="All branches"
      />

      <button
        type="submit"
        className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Apply
      </button>
      <a href={`${basePath}?date=${date}`} className="flex h-10 items-center px-2 text-sm text-slate-500 underline-offset-2 hover:underline">
        Clear
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
