/**
 * Batch 13 — persistence for the scheduled processing job: run history, the per-(company, work
 * date) advisory lock, and the few company-scoped reads the job needs. Every query takes an
 * explicit `companyId`.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { attendanceDailyRecords, attendanceProcessingRuns, branches, companies, shifts, workSchedules } from "@/db/schema";
import type { ShiftWindow } from "./due-dates";

export type AttendanceProcessingRun = typeof attendanceProcessingRuns.$inferSelect;
export type ProcessingTrigger = AttendanceProcessingRun["trigger"];

export type CompanyProcessingInputs = { timezones: string[]; windows: ShiftWindow[] };

export const attendanceProcessingRepository = {
  /** Companies the scheduled job covers — decided here, from the database, never by the caller. */
  listActiveCompanies(executor: DbExecutor = db): Promise<{ id: string; timezone: string }[]> {
    return executor.select({ id: companies.id, timezone: companies.timezone }).from(companies).where(eq(companies.status, "active"));
  },

  /** Every timezone the company operates in plus every active shift/schedule window — the inputs of
   *  the "is this work date finished" rule (see due-dates.ts). */
  async getCompanyProcessingInputs(companyId: string, companyTimezone: string, executor: DbExecutor = db): Promise<CompanyProcessingInputs> {
    const [branchRows, scheduleRows, shiftRows] = await Promise.all([
      executor.select({ timezone: branches.timezone }).from(branches).where(and(eq(branches.companyId, companyId), eq(branches.isActive, true))),
      executor
        .select({ timezone: workSchedules.timezone, startTime: workSchedules.startTime, endTime: workSchedules.endTime })
        .from(workSchedules)
        .where(and(eq(workSchedules.companyId, companyId), eq(workSchedules.isActive, true))),
      executor
        .select({ startTime: shifts.startTime, endTime: shifts.endTime })
        .from(shifts)
        .where(and(eq(shifts.companyId, companyId), eq(shifts.isActive, true))),
    ]);

    const timezones = new Set<string>([companyTimezone]);
    for (const row of branchRows) if (row.timezone) timezones.add(row.timezone);
    for (const row of scheduleRows) if (row.timezone) timezones.add(row.timezone);

    const windows = new Map<string, ShiftWindow>();
    for (const row of [...scheduleRows, ...shiftRows]) windows.set(`${row.startTime}|${row.endTime}`, { startTime: row.startTime, endTime: row.endTime });

    return { timezones: [...timezones], windows: [...windows.values()] };
  },

  async getCompanyTimezone(companyId: string, executor: DbExecutor = db): Promise<string> {
    const rows = await executor.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!rows[0]) throw new Error("Company not found for attendance processing.");
    return rows[0].timezone;
  },

  /**
   * Employees eligible for a daily record on `workDate`, judged by the employment status the
   * system recorded AS OF the end of that work date (`asOf` = the instant the date ended), not the
   * status they have today.
   *
   * Why: the job re-examines the last N dates on every run, so judging by the current status would
   * mint ABSENT records for days a since-reinstated employee was SUSPENDED / on PROBATION /
   * ON_LEAVE, and would skip the ABSENT day of someone who has since resigned. The status at
   * `asOf` is the `before` status of the FIRST status-change history event recorded at or after
   * `asOf` (`changeEmployeeStatus` is the only writer of `employment_status` and always writes that
   * event in the same transaction); with no later event the current status is unchanged since then.
   *
   * LIMITATION (deliberate, documented): history rows carry the time the change was RECORDED, not
   * the date it took effect — `employees.date_of_exit` and `employee_history.effective_date` exist
   * but are never populated — so this is "status as known to the system", not the true effective
   * status. Capturing effective dates is an employee-domain change and is deferred. Archived
   * employees and employees who had not yet joined stay excluded, as in manual processing.
   */
  async listEligibleEmployeeIdsAsOf(companyId: string, workDate: string, asOf: Date, executor: DbExecutor = db): Promise<string[]> {
    const result = await executor.execute<{ id: string }>(sql`
      select e.id
      from employees e
      left join (
        select distinct on (h.employee_id) h.employee_id, h.before ->> 'employmentStatus' as status_before
        from employee_history h
        where h.company_id = ${companyId}
          and h.event_type::text in ('STATUS_CHANGED', 'RESIGNED', 'TERMINATED')
          and h.created_at >= ${asOf.toISOString()}::timestamptz
        order by h.employee_id, h.created_at asc, h.id asc
      ) c on c.employee_id = e.id
      where e.company_id = ${companyId}
        and e.is_archived = false
        and e.date_of_joining <= ${workDate}::date
        and coalesce(c.status_before, e.employment_status::text) = 'ACTIVE'
    `);
    return result.rows.map((row) => row.id);
  },

  /** One query: which employees already have a daily record for the date. */
  async listEmployeeIdsWithRecord(companyId: string, workDate: string, executor: DbExecutor = db): Promise<Set<string>> {
    const rows = await executor
      .select({ employeeId: attendanceDailyRecords.employeeId })
      .from(attendanceDailyRecords)
      .where(and(eq(attendanceDailyRecords.companyId, companyId), eq(attendanceDailyRecords.workDate, workDate)));
    return new Set(rows.map((row) => row.employeeId));
  },

  /**
   * Runs `fn` while holding a PostgreSQL advisory lock for (company, work date), or reports
   * `acquired: false` immediately if another session — another process, another instance — holds
   * it. The database is the only source of truth; there is no in-memory state.
   *
   * It is a TRANSACTION-level lock (`pg_try_advisory_xact_lock`) held by a dedicated transaction
   * that does nothing else: the processing work itself runs on other pooled connections with its
   * own short per-employee transactions, so this is not one giant transaction around the run. A
   * transaction-level lock is used deliberately instead of a session-level one: behind a
   * transaction-mode pooler (PgBouncer, Neon's `-pooler` endpoint — what this project's development
   * database uses) session-level locks are not tied to a stable backend and silently fail to
   * exclude, whereas a transaction pins one backend for its duration. The lock is released when the
   * transaction ends, including if the process dies (the connection drops and the transaction is
   * aborted), so it can never be left held.
   */
  async withProcessingLock<T>(
    companyId: string,
    workDate: string,
    fn: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    let outcome: { acquired: true; value: T } | { acquired: false } = { acquired: false };
    await db.transaction(async (tx) => {
      const result = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${`attendance_processing:${companyId}`}), hashtext(${workDate})) as locked`,
      );
      if (!result.rows[0]?.locked) return;
      outcome = { acquired: true, value: await fn() };
    });
    return outcome;
  },

  /** Called only while holding the advisory lock: no live process owns a RUNNING row for this
   *  (company, work date), so any that remain were left by a crashed run. */
  async abandonStaleRunning(companyId: string, workDate: string, executor: DbExecutor = db): Promise<void> {
    await executor
      .update(attendanceProcessingRuns)
      .set({ status: "FAILED", finishedAt: new Date(), message: "Abandoned: the previous run did not finish." })
      .where(
        and(
          eq(attendanceProcessingRuns.companyId, companyId),
          eq(attendanceProcessingRuns.workDate, workDate),
          eq(attendanceProcessingRuns.status, "RUNNING"),
        ),
      );
  },

  async insertRunning(companyId: string, workDate: string, trigger: ProcessingTrigger, executor: DbExecutor = db): Promise<AttendanceProcessingRun> {
    const rows = await executor.insert(attendanceProcessingRuns).values({ companyId, workDate, trigger, status: "RUNNING" }).returning();
    return rows[0]!;
  },

  async finish(
    runId: string,
    companyId: string,
    input: { status: "COMPLETED" | "FAILED"; createdCount: number; skippedCount: number; failedCount: number; message: string | null },
    executor: DbExecutor = db,
  ): Promise<AttendanceProcessingRun> {
    const rows = await executor
      .update(attendanceProcessingRuns)
      .set({ ...input, finishedAt: new Date() })
      .where(and(eq(attendanceProcessingRuns.id, runId), eq(attendanceProcessingRuns.companyId, companyId)))
      .returning();
    return rows[0]!;
  },

  listByCompany(companyId: string, pagination: { page: number; pageSize: number }, executor: DbExecutor = db): Promise<AttendanceProcessingRun[]> {
    return executor
      .select()
      .from(attendanceProcessingRuns)
      .where(eq(attendanceProcessingRuns.companyId, companyId))
      .orderBy(desc(attendanceProcessingRuns.startedAt), desc(attendanceProcessingRuns.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);
  },

  async countByCompany(companyId: string, executor: DbExecutor = db): Promise<number> {
    const rows = await executor
      .select({ value: sql<number>`${count()}::int` })
      .from(attendanceProcessingRuns)
      .where(eq(attendanceProcessingRuns.companyId, companyId));
    return rows[0]?.value ?? 0;
  },
};
