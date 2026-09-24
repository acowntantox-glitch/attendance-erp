"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type ReportFilters = {
  fromDate: string;
  toDate: string;
  employeeId?: string;
  departmentId?: string;
  locationId?: string;
  status?: string;
  search?: string;
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/**
 * Reuses the exact same filter values the page rendered the report with (props, not its own
 * re-derivation) — the API route itself re-validates and re-applies them through the same
 * `attendanceReportFiltersSchema` + `attendanceReportRepository` the report page used, so an
 * export can never reflect a different filter set than what's on screen (§20/§27).
 */
export function ExportCsvButton({ filters }: { filters: ReportFilters }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }

      const response = await fetch(`/api/attendance/reports/export?${params.toString()}`);
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to export the report."));
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? `attendance-report-${filters.fromDate}-to-${filters.toDate}.csv`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={() => void handleExport()} disabled={exporting} aria-busy={exporting}>
        {exporting ? "Exporting…" : "Export CSV"}
      </Button>
      {error && (
        <div role="alert" className="max-w-xs rounded-md border border-red-200 bg-red-50 px-3 py-2 text-right text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
