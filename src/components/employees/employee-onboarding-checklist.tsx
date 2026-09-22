"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { EmployeeOnboardingWithTasks } from "@/domains/employee/model";

const STATUS_VARIANT = {
  DRAFT: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
} as const;

export function EmployeeOnboardingChecklist({
  employeeId,
  onboarding,
  onboardingStatus,
  canManage,
}: {
  employeeId: string;
  onboarding: EmployeeOnboardingWithTasks | null;
  onboardingStatus: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleStart() {
    setBusy(true);
    await fetch(`/api/employees/${employeeId}/onboarding`, { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  async function handleToggle(taskId: string, isCompleted: boolean) {
    setBusy(true);
    await fetch(`/api/employees/${employeeId}/onboarding/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted }),
    });
    router.refresh();
    setBusy(false);
  }

  if (!onboarding) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Onboarding hasn&apos;t started for this employee yet.</p>
        {canManage && (
          <Button onClick={handleStart} disabled={busy}>
            {busy ? "Starting…" : "Start Onboarding"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Badge variant={STATUS_VARIANT[onboardingStatus as keyof typeof STATUS_VARIANT] ?? "neutral"}>
        {onboardingStatus.replaceAll("_", " ")}
      </Badge>
      <ul className="space-y-2">
        {onboarding.tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={task.isCompleted}
              disabled={!canManage || busy}
              onChange={(e) => handleToggle(task.id, e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span className={task.isCompleted ? "text-sm text-slate-400 line-through" : "text-sm text-slate-700"}>
              {task.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
