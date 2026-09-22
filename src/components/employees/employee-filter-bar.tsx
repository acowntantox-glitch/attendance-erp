"use client";

import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Option = { id: string; name: string };

/**
 * A plain GET form, not client-side fetch/state: every filter change navigates to a new URL
 * (`/employees?department=...&status=...`), so the employee directory page stays a
 * server-rendered component that reads `searchParams` — bookmarkable, shareable, and consistent
 * with the rest of this app's server-first pages. Selecting a filter auto-submits the form.
 */
export function EmployeeFilterBar({
  basePath,
  defaults,
  departments,
  designations,
  locations,
}: {
  basePath: string;
  defaults: {
    search?: string;
    departmentId?: string;
    designationId?: string;
    locationId?: string;
    status?: string;
    employmentType?: string;
    sort?: string;
  };
  departments: Option[];
  designations: Option[];
  locations: Option[];
}) {
  function submitForm(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={basePath} method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="min-w-[200px] flex-1">
        <Label htmlFor="search">Search</Label>
        <Input id="search" name="search" placeholder="Name, email, employee #" defaultValue={defaults.search} />
      </div>

      <FilterSelect name="departmentId" label="Department" defaultValue={defaults.departmentId} onSelect={submitForm} options={departments} />
      <FilterSelect name="designationId" label="Designation" defaultValue={defaults.designationId} onSelect={submitForm} options={designations} />
      <FilterSelect name="locationId" label="Location" defaultValue={defaults.locationId} onSelect={submitForm} options={locations} />
      <FilterSelect
        name="status"
        label="Status"
        defaultValue={defaults.status}
        onSelect={submitForm}
        options={[
          "ACTIVE",
          "PROBATION",
          "ON_LEAVE",
          "NOTICE_PERIOD",
          "SUSPENDED",
          "RESIGNED",
          "TERMINATED",
          "INACTIVE",
        ].map((s) => ({ id: s, name: s.replaceAll("_", " ") }))}
      />
      <FilterSelect
        name="employmentType"
        label="Type"
        defaultValue={defaults.employmentType}
        onSelect={submitForm}
        options={["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY", "FREELANCE"].map((t) => ({
          id: t,
          name: t.replaceAll("_", " "),
        }))}
      />

      <button
        type="submit"
        className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Apply
      </button>
      <a href={basePath} className="h-10 px-2 text-sm text-slate-500 underline-offset-2 hover:underline flex items-center">
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
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: Option[];
  onSelect: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div className="min-w-[160px]">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        onChange={onSelect}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}
