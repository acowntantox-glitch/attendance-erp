"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";

type SearchResult = { id: string; firstName: string; lastName: string; employeeNumber: string };

/**
 * Server-side search (via the existing paginated employee list endpoint), not client-side
 * filtering of a preloaded tree — the chart never holds the full employee set in the browser.
 * Selecting a result opens that employee's profile directly rather than expanding the tree down
 * to it (a deliberately simpler interaction — see Phase 2 build notes).
 */
export function OrgChartSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  async function handleChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const response = await fetch(`/api/employees?search=${encodeURIComponent(value)}&pageSize=8`);
    const body = await response.json();
    setResults(body.data.items);
    setOpen(true);
  }

  return (
    <div className="relative max-w-sm">
      <Input
        placeholder="Search employees…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/employees/${r.id}`}
              className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {r.firstName} {r.lastName} <span className="text-xs text-slate-400">{r.employeeNumber}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
