import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Execution time budget — DB-free. The repository, period guard, audit log and the per-employee
 * write are replaced by an in-memory model of the database; a fake clock advances 10 ms per
 * employee. This exercises the real orchestration (`runScheduledAttendanceProcessing` /
 * `processCompanyWorkDate`) without any database, so it runs anywhere.
 */

type Run = { id: string; workDate: string; status: string; createdCount: number; skippedCount: number; failedCount: number; message: string | null };

const state = vi.hoisted(() => ({
  records: new Set<string>(), // `${workDate}|${employeeId}` — stands in for the unique (employee, work date) index
  runs: [] as Run[],
  eligible: [] as string[],
  audits: [] as { action: string; newData: { status: string; message: string | null } }[],
  materializeCalls: [] as string[],
}));

vi.mock("../attendance-processing.repository", () => ({
  attendanceProcessingRepository: {
    listActiveCompanies: async () => [{ id: "company-1", timezone: "UTC" }],
    getCompanyProcessingInputs: async () => ({ timezones: ["UTC"], windows: [] }),
    getCompanyTimezone: async () => "UTC",
    listEligibleEmployeeIdsAsOf: async () => [...state.eligible],
    listEmployeeIdsWithRecord: async (_companyId: string, workDate: string) =>
      new Set([...state.records].filter((key) => key.startsWith(`${workDate}|`)).map((key) => key.split("|")[1]!)),
    withProcessingLock: async (_c: string, _d: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn() }),
    abandonStaleRunning: async () => undefined,
    insertRunning: async (_companyId: string, workDate: string) => {
      const run: Run = { id: `run-${state.runs.length + 1}`, workDate, status: "RUNNING", createdCount: 0, skippedCount: 0, failedCount: 0, message: null };
      state.runs.push(run);
      return { ...run, companyId: "company-1", trigger: "SCHEDULED" };
    },
    finish: async (runId: string, _companyId: string, input: Omit<Run, "id" | "workDate">) => {
      const run = state.runs.find((r) => r.id === runId)!;
      Object.assign(run, { status: input.status, createdCount: input.createdCount, skippedCount: input.skippedCount, failedCount: input.failedCount, message: input.message });
      return { ...run, companyId: "company-1", trigger: "SCHEDULED" };
    },
  },
}));
vi.mock("../../periods/attendance-period.service", () => ({ isAttendancePeriodClosed: async () => false }));
vi.mock("../../service", () => ({ materializeMissingDailyRecord: vi.fn() }));
vi.mock("@/domains/audit/service", () => ({
  recordAuditLog: async (_ctx: unknown, input: { action: string; newData: { status: string; message: string | null } }) => {
    state.audits.push({ action: input.action, newData: input.newData });
  },
}));

const service = await import("../attendance-auto-processing.service");

const NOW = new Date("2026-04-10T12:00:00Z"); // lag 180, lookback 1 -> processes 2026-04-09
const WORK_DATE = "2026-04-09";
const OPTIONS = { now: NOW, lagMinutes: 180, lookbackDays: 1 };

/** A fake clock advancing 10 ms per employee written. */
function fakeDeps(options: { failFor?: string } = {}) {
  let now = 0;
  return {
    clock: () => now,
    materialize: async (_companyId: string, employeeId: string, workDate: string) => {
      state.materializeCalls.push(`${workDate}|${employeeId}`);
      now += 10;
      if (employeeId === options.failFor) throw new Error("simulated failure");
      const key = `${workDate}|${employeeId}`;
      if (state.records.has(key)) return "SKIPPED_EXISTING" as const;
      state.records.add(key);
      return "CREATED" as const;
    },
  };
}

beforeEach(() => {
  state.records.clear();
  state.runs.length = 0;
  state.audits.length = 0;
  state.materializeCalls.length = 0;
  state.eligible = ["e1", "e2", "e3", "e4", "e5"];
});

describe("execution time budget", () => {
  it("stops between employees when the budget is spent and does NOT report the run as successful", async () => {
    // Employees are checked before each start: e1 (t=0), e2 (10), e3 (20) start; at t=30 >= 25 the budget is spent.
    const summary = await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 25 }, fakeDeps());

    const date = summary.companies[0]!.dates[0]!;
    expect(date).toMatchObject({ workDate: WORK_DATE, outcome: "INCOMPLETE", created: 3, remaining: 2, failed: 0 });
    expect(summary).toMatchObject({ stoppedEarly: true, created: 3, companiesProcessed: 1 });

    // Processed employees have records; the rest were deliberately left alone.
    expect([...state.records].sort()).toEqual([`${WORK_DATE}|e1`, `${WORK_DATE}|e2`, `${WORK_DATE}|e3`]);

    // The run row is finalized truthfully: not COMPLETED, with the reason and how many remain.
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ status: "FAILED", createdCount: 3, failedCount: 0 });
    expect(state.runs[0]!.message).toMatch(/Stopped early: time budget reached with 2 employee\(s\) not yet processed/);
    expect(state.runs.filter((r) => r.status === "RUNNING")).toHaveLength(0);

    // One summary audit entry, carrying the same non-success status.
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: "attendance.process.scheduled", newData: { status: "FAILED" } });
  });

  it("a later invocation resumes exactly where the interrupted one stopped, with no duplicates or repeated effects", async () => {
    await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 25 }, fakeDeps());
    const firstCalls = [...state.materializeCalls];
    expect(firstCalls).toHaveLength(3);

    // Next scheduler invocation: fresh budget. Only the two unprocessed employees are worked on.
    const second = await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 25 }, fakeDeps());
    expect(second.companies[0]!.dates[0]).toMatchObject({ outcome: "PROCESSED", created: 2, skipped: 3, remaining: 0 });
    expect(second.stoppedEarly).toBe(false);

    expect(state.materializeCalls.slice(3).map((c) => c.split("|")[1])).toEqual(["e4", "e5"]);
    // Every employee was materialized exactly once across both invocations.
    expect(new Set(state.materializeCalls).size).toBe(state.materializeCalls.length);
    expect(state.records.size).toBe(5);

    // The second run is a normal successful run.
    expect(state.runs).toHaveLength(2);
    expect(state.runs[1]).toMatchObject({ status: "COMPLETED", createdCount: 2, skippedCount: 3, failedCount: 0, message: null });
    expect(state.audits.map((a) => a.newData.status)).toEqual(["FAILED", "COMPLETED"]);

    // A third invocation finds nothing to do: no writes, no new run row.
    const third = await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 25 }, fakeDeps());
    expect(third.companies[0]!.dates[0]).toMatchObject({ outcome: "UP_TO_DATE", created: 0 });
    expect(state.runs).toHaveLength(2);
    expect(state.records.size).toBe(5);
  });

  it("does not start any work when the budget is already spent", async () => {
    const summary = await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 0 }, fakeDeps());
    expect(summary.stoppedEarly).toBe(true);
    expect(summary.created).toBe(0);
    expect(state.materializeCalls).toHaveLength(0);
    expect(state.runs).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("does not start a further work date once the budget is spent (older dates first)", async () => {
    // lookback 2 -> dates 2026-04-08 then 2026-04-09; the first consumes the whole budget.
    const summary = await service.runScheduledAttendanceProcessing({ ...OPTIONS, lookbackDays: 2, timeBudgetMs: 25 }, fakeDeps());
    expect(summary.stoppedEarly).toBe(true);
    expect(summary.companies[0]!.dates.map((d) => d.workDate)).toEqual(["2026-04-08"]);
    expect(state.runs.map((r) => r.workDate)).toEqual(["2026-04-08"]);
    expect([...state.records].every((key) => key.startsWith("2026-04-08|"))).toBe(true);
  });

  it("finishes normally when the budget is ample (no early stop, run COMPLETED)", async () => {
    const summary = await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 10_000 }, fakeDeps());
    expect(summary.stoppedEarly).toBe(false);
    expect(summary.companies[0]!.dates[0]).toMatchObject({ outcome: "PROCESSED", created: 5, remaining: 0 });
    expect(state.runs[0]).toMatchObject({ status: "COMPLETED", createdCount: 5 });
  });

  it("with no budget configured the job is unlimited (scripts/tests keep the old behaviour)", async () => {
    const summary = await service.runScheduledAttendanceProcessing(OPTIONS, fakeDeps());
    expect(summary.stoppedEarly).toBe(false);
    expect(summary.created).toBe(5);
  });

  it("an employee failure is isolated and reported alongside an early stop", async () => {
    const summary = await service.runScheduledAttendanceProcessing({ ...OPTIONS, timeBudgetMs: 25 }, fakeDeps({ failFor: "e2" }));
    expect(summary.companies[0]!.dates[0]).toMatchObject({ outcome: "INCOMPLETE", created: 2, failed: 1, remaining: 2 });
    expect(state.runs[0]!.message).toContain("Stopped early");
    expect(state.runs[0]!.message).toContain("e2");
    expect(state.runs[0]).toMatchObject({ status: "FAILED", failedCount: 1 });
  });
});
