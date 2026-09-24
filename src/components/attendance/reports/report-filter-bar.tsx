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
 * Same server-driven GET-form convention as `DashboardFilterBar` — every filter change (including
 * the date range) navigates to a new URL and the report page re-fetches server-side; nothing here
 * filters an already-fetched list client-side. Submitting this form always resets `page` to 1
 * (it's simply not one of this form's fields), which is the desired behavior when filters change.
 */
export function ReportFilterBar({
  basePath,
  defaults,
  employees,
  departments,
  locations,
}: {
  basePath: string;
  defaults: { fromDate: string; toDate: string; employeeId?: string; departmentId?: string; locationId?: string; status?: string; search?: string };
  employees: Option[];
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
          <Label htmlFor="report-from-date">From Date</Label>
          <Input id="report-from-date" name="fromDate" type="date" defaultValue={defaults.fromDate} max={defaults.toDate} />
        </div>
        <div>
          <Label htmlFor="report-to-date">To Date</Label>
          <Input id="report-to-date" name="toDate" type="date" defaultValue={defaults.toDate} min={defaults.fromDate} />
        </div>

        <FilterSelect name="employeeId" label="Employee" defaultValue={defaults.employeeId} onSelect={submitForm} options={employees} allLabel="All employees" />
        <FilterSelect
          name="departmentId"
          label="Department"
          defaultValue={defaults.departmentId}
          onSelect={submitForm}
          options={departments}
          allLabel="All departments"
        />
        <FilterSelect name="locationId" label="Location" defaultValue={defaults.locationId} onSelect={submitForm} options={locations} allLabel="All locations" />
        <FilterSelect name="status" label="Status" defaultValue={defaults.status} onSelect={submitForm} options={STATUS_OPTIONS} allLabel="All statuses" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="report-search">Search employees</Label>
          <Input id="report-search" name="search" placeholder="Name or employee #" defaultValue={defaults.search} />
        </div>

        <button
          type="submit"
          className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
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
