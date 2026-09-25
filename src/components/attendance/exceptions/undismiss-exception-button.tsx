"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ExceptionType = "LATE" | "INCOMPLETE" | "ABSENT" | "EARLY_DEPARTURE";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

/** Never optimistic — the row keeps showing "Dismissed" until the server confirms the removal,
 *  then `router.refresh()` re-fetches the authoritative queue. */
export function UndismissExceptionButton({ employeeId, workDate, exceptionType }: { employeeId: string; workDate: string; exceptionType: ExceptionType }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUndismiss() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/attendance/exceptions/undismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, workDate, exceptionType }),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Unable to undismiss this exception."));
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => void handleUndismiss()} disabled={submitting} aria-busy={submitting}>
        {submitting ? "Undismissing…" : "Undismiss"}
      </Button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
