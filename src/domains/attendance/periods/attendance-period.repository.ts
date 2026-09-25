/**
 * Batch 8 — attendance period closing/locking. A month with no `attendance_periods` row is
 * implicitly OPEN (never closed) — the same "absence means not yet touched, not a negative fact"
 * convention Batch 5 established for daily records (no row ≠ ABSENT). `ensure()` lazily
 * materializes a row the first time a period is ever checked or closed, so HR never has to
 * pre-create a period before using it (§25 — no manual "create period" endpoint).
 *
 * Concurrency (§23/§24): `findForShare`/`findForUpdate` are the same `SELECT ... FOR <mode>`
 * row-locking technique already established by `attendanceSessionRepository.findOpenForEmployeeLocked`
 * and `attendanceCorrectionRepository.findByIdLocked` — just two different lock strengths on the
 * SAME row, both requiring `ensure()` first so there is always something to lock:
 *   - Ordinary mutations take a SHARE lock (`assertAttendancePeriodOpen`): many can hold it
 *     concurrently (they're not writing to the period row), but it blocks a concurrent close's
 *     exclusive lock attempt until every in-flight mutation's transaction finishes.
 *   - Closing takes an UPDATE (exclusive) lock: it waits for any in-flight mutation's share lock
 *     to release, and once held, blocks any *new* mutation's share-lock attempt until the close
 *     transaction commits or rolls back — at which point the mutation re-reads the row and sees
 *     the true, post-close status. This is what makes the §24 race ("check open, then a concurrent
 *     close, then mutate") impossible: the mutation's own lock acquisition is what serializes it
 *     against the close, not merely an earlier unlocked read.
 */
import { and, eq } from "drizzle-orm";
import { db, type DbExecutor, type Transaction } from "@/db/client";
import { attendancePeriods } from "@/db/schema";

export type AttendancePeriod = typeof attendancePeriods.$inferSelect;

export const attendancePeriodRepository = {
  /** Guarantees a row exists for (companyId, periodMonth), defaulting to OPEN — a no-op if one
   *  already exists. Must be called before either locked-read method below. */
  async ensure(companyId: string, periodMonth: string, executor: DbExecutor = db): Promise<void> {
    await executor
      .insert(attendancePeriods)
      .values({ companyId, periodMonth, status: "OPEN" })
      .onConflictDoNothing({ target: [attendancePeriods.companyId, attendancePeriods.periodMonth] });
  },

  findByCompanyAndMonth(companyId: string, periodMonth: string, executor: DbExecutor = db): Promise<AttendancePeriod | undefined> {
    return executor.query.attendancePeriods.findFirst({
      where: and(eq(attendancePeriods.companyId, companyId), eq(attendancePeriods.periodMonth, periodMonth)),
    });
  },

  /** Same lookup, joined to the closing user's display name — for the UI ("Closed by: ..."),
   *  never a second identity lookup elsewhere. */
  findByCompanyAndMonthWithDetails(companyId: string, periodMonth: string, executor: DbExecutor = db) {
    return executor.query.attendancePeriods.findFirst({
      where: and(eq(attendancePeriods.companyId, companyId), eq(attendancePeriods.periodMonth, periodMonth)),
      with: { closedBy: { columns: { id: true, fullName: true } } },
    });
  },

  /** Shared lock — for a plain mutation's period-open check (see module doc above). Must be
   *  called inside a transaction; the row is guaranteed to exist by a prior `ensure()` call. */
  async findForShare(companyId: string, periodMonth: string, tx: Transaction): Promise<AttendancePeriod> {
    const rows = await tx
      .select()
      .from(attendancePeriods)
      .where(and(eq(attendancePeriods.companyId, companyId), eq(attendancePeriods.periodMonth, periodMonth)))
      .for("share");
    return rows[0]!;
  },

  /** Exclusive lock — for closing/reopening (see module doc above). */
  async findForUpdate(companyId: string, periodMonth: string, tx: Transaction): Promise<AttendancePeriod> {
    const rows = await tx
      .select()
      .from(attendancePeriods)
      .where(and(eq(attendancePeriods.companyId, companyId), eq(attendancePeriods.periodMonth, periodMonth)))
      .for("update");
    return rows[0]!;
  },

  listByCompanyWithDetails(companyId: string, executor: DbExecutor = db) {
    return executor.query.attendancePeriods.findMany({
      where: eq(attendancePeriods.companyId, companyId),
      orderBy: (table, { desc }) => [desc(table.periodMonth)],
      with: { closedBy: { columns: { id: true, fullName: true } } },
    });
  },

  close(id: string, closedByUserId: string, executor: DbExecutor = db) {
    return executor
      .update(attendancePeriods)
      .set({ status: "CLOSED", closedAt: new Date(), closedByUserId })
      .where(eq(attendancePeriods.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },

  reopen(id: string, executor: DbExecutor = db) {
    return executor
      .update(attendancePeriods)
      .set({ status: "OPEN", closedAt: null, closedByUserId: null })
      .where(eq(attendancePeriods.id, id))
      .returning()
      .then((rows) => rows[0]!);
  },
};
