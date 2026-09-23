"use client";

import type { ChangeEvent } from "react";
import { Label } from "@/components/ui/label";

type Employee = { id: string; name: string; employeeNumber: string };

/**
 * Same GET-form-auto-submit pattern as EmployeeFilterBar — selecting an employee navigates to a
 * new URL rather than fetching client-side, keeping the calendar page a server-rendered,
 * bookmarkable view consistent with the rest of this app.
 */
export function CalendarEmployeeSelect({
  month,
  selectedEmployeeId,
  employees,
}: {
  month: string;
  selectedEmployeeId: string | null;
  employees: Employee[];
}) {
  function submitForm(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action="/workforce/calendar" method="GET" className="flex items-end gap-2">
      <input type="hidden" name="month" value={month} />
      <div className="min-w-[220px]">
        <Label htmlFor="calendar-employee">Employee</Label>
        <select
          id="calendar-employee"
          name="employeeId"
          defaultValue={selectedEmployeeId ?? ""}
          onChange={submitForm}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
        >
          <option value="">Select an employee</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} ({employee.employeeNumber})
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
