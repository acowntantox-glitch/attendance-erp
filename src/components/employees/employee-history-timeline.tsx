import type { EmployeeHistoryEntry } from "@/domains/employee/model";

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Employee record created",
  DEPARTMENT_CHANGED: "Department changed",
  DESIGNATION_CHANGED: "Designation changed",
  MANAGER_CHANGED: "Manager changed",
  LOCATION_CHANGED: "Location changed",
  EMPLOYMENT_TYPE_CHANGED: "Employment type changed",
  STATUS_CHANGED: "Status changed",
  PROMOTION: "Promotion",
  TRANSFER: "Transfer",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
  ARCHIVED: "Archived",
};

// Only these event types carry a single-field { fieldName: value } before/after snapshot (see
// FIELD_EVENT_MAP / STATUS_EVENT_MAP in domains/employee/service.ts) — safe to display as a
// "before → after" diff regardless of jsonb key order (Postgres's jsonb does NOT preserve
// insertion order, but a single-key object has no ordering ambiguity). CREATED/ARCHIVED store a
// multi-field snapshot instead, which isn't a single before/after comparison, so they're
// deliberately excluded rather than shown as a misleading one-line diff.
const SINGLE_FIELD_DIFF_EVENTS = new Set([
  "DEPARTMENT_CHANGED",
  "DESIGNATION_CHANGED",
  "MANAGER_CHANGED",
  "LOCATION_CHANGED",
  "EMPLOYMENT_TYPE_CHANGED",
  "STATUS_CHANGED",
  "RESIGNED",
  "TERMINATED",
]);

function describeChange(entry: EmployeeHistoryEntry): string | null {
  if (!SINGLE_FIELD_DIFF_EVENTS.has(entry.eventType)) return null;
  const before = entry.before as Record<string, unknown> | null;
  const after = entry.after as Record<string, unknown> | null;
  const beforeValue = before ? Object.values(before)[0] : undefined;
  const afterValue = after ? Object.values(after)[0] : undefined;
  if (beforeValue === undefined && afterValue === undefined) return null;
  return `${beforeValue ?? "—"} → ${afterValue ?? "—"}`;
}

export function EmployeeHistoryTimeline({ history }: { history: EmployeeHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-slate-500">No history recorded yet.</p>;
  }

  return (
    <ol className="space-y-4">
      {history.map((entry) => {
        const change = describeChange(entry);
        return (
          <li key={entry.id} className="border-l-2 border-slate-200 pl-4">
            <p className="text-sm font-medium text-slate-800">{EVENT_LABELS[entry.eventType] ?? entry.eventType}</p>
            {change && <p className="text-sm text-slate-600">{change}</p>}
            {entry.note && <p className="text-sm text-slate-500">{entry.note}</p>}
            <p className="mt-0.5 text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</p>
          </li>
        );
      })}
    </ol>
  );
}
