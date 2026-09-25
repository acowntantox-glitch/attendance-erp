"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AttendanceSessionView } from "@/domains/attendance/model";
import { formatInstant } from "./format";

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

type Action = "check-in" | "check-out" | "break-start" | "break-end";

const ACTION_PATH: Record<Action, string> = {
  "check-in": "check-in",
  "check-out": "check-out",
  "break-start": "breaks/start",
  "break-end": "breaks/end",
};

/**
 * The server is authoritative for every state transition here — this component never assumes an
 * action succeeded before the API responds, and never invents session/break state on its own. All
 * display state (`session`, `hasOpenBreak`) comes from props supplied by the parent Server
 * Component; after a successful mutation this panel calls `router.refresh()` so the server
 * re-fetches and passes down the new authoritative state, rather than guessing it locally.
 */
export function CurrentSessionPanel({
  employeeId,
  canControl,
  session,
  hasOpenBreak,
  periodClosed,
}: {
  employeeId: string;
  canControl: boolean;
  session: AttendanceSessionView | null;
  hasOpenBreak: boolean;
  periodClosed: boolean;
}) {
  const router = useRouter();
  // Which action is currently in flight, if any — not just a shared boolean, so a button never
  // shows an "in-flight" label for an action a different button triggered.
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = pendingAction !== null;
  // The server independently rejects check-in/out/break mutations for a closed period (§4) — this
  // just keeps the buttons from being clickable and confusing when that's already known client-side.
  const controlsEnabled = canControl && !periodClosed;

  async function perform(action: Action) {
    if (submitting) return; // prevent accidental double submission from a fast double-click
    setPendingAction(action);
    setError(null);
    try {
      const response = await fetch(`/api/employees/${employeeId}/attendance/${ACTION_PATH[action]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(await parseErrorMessage(response, "Something went wrong. Please try again."));
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Session</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {periodClosed && canControl && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            This month&apos;s attendance period is closed, so check-in, check-out, and break actions are unavailable for it.
          </p>
        )}

        {!session ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">You are not currently checked in.</p>
            {canControl && (
              <Button
                onClick={() => perform("check-in")}
                disabled={submitting || !controlsEnabled}
                aria-busy={pendingAction === "check-in"}
              >
                {pendingAction === "check-in" ? "Checking in…" : "Check In"}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-600">
                  Checked in at <span className="font-medium text-slate-900">{formatInstant(session.checkInAt, session.resolvedTimezone)}</span>
                </p>
                {session.expectedWorkSchedule && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    Expected shift: {session.expectedShift?.name ?? session.expectedWorkSchedule.name}
                  </p>
                )}
              </div>
              <Badge variant={hasOpenBreak ? "warning" : "info"}>{hasOpenBreak ? "On Break" : "Active"}</Badge>
            </div>

            {canControl && (
              <div className="flex flex-wrap gap-2">
                {hasOpenBreak ? (
                  <Button
                    variant="secondary"
                    onClick={() => perform("break-end")}
                    disabled={submitting || !controlsEnabled}
                    aria-busy={pendingAction === "break-end"}
                  >
                    {pendingAction === "break-end" ? "Ending break…" : "End Break"}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => perform("break-start")}
                    disabled={submitting || !controlsEnabled}
                    aria-busy={pendingAction === "break-start"}
                  >
                    {pendingAction === "break-start" ? "Starting break…" : "Start Break"}
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={() => perform("check-out")}
                  disabled={submitting || hasOpenBreak || !controlsEnabled}
                  aria-busy={pendingAction === "check-out"}
                  title={hasOpenBreak ? "End your break first" : undefined}
                >
                  {pendingAction === "check-out" ? "Checking out…" : "Check Out"}
                </Button>
              </div>
            )}
            {hasOpenBreak && canControl && <p className="text-xs text-slate-400">End your break before checking out.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
