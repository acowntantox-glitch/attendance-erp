"use client";

// 0 (Sunday) - 6 (Saturday), matching the backend's day-of-week convention exactly
// (src/lib/datetime dayOfWeekInZone) — never reorder or relabel these without checking that file.
const DAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];

export function WeekdaySelect({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  function toggle(day: number) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort());
  }

  return (
    <div role="group" aria-label="Off days" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {DAYS.map((day) => {
        const checked = value.includes(day.value);
        return (
          <label
            key={day.value}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              checked ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-300 text-slate-700"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(day.value)}
              className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            {day.label}
          </label>
        );
      })}
    </div>
  );
}

/** Human-readable day names for display, e.g. [5, 6] -> "Friday, Saturday". Never raw integers. */
export function formatOffDays(days: number[]): string {
  if (days.length === 0) return "None";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const byValue = new Map(DAYS.map((d) => [d.value, d.label]));
  return order
    .filter((d) => days.includes(d))
    .map((d) => byValue.get(d))
    .join(", ");
}
