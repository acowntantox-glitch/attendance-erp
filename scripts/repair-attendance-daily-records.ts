import "./load-env";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { assertSafeDatabaseTarget } from "../src/lib/db-safety";
import { recalculateExistingDailyRecordForRepair } from "../src/domains/attendance/service";
import { attendancePeriodRepository } from "../src/domains/attendance/periods/attendance-period.repository";

/**
 * F-01 one-time repair: finds EXISTING attendance_daily_records that no longer match the attendance
 * activity behind them (rows left stale by the old read-time materialization, or by a check-in /
 * break that did not refresh them) and recalculates them through the one calculation engine.
 *
 *   pnpm attendance:repair                      # DRY RUN (default): inspects and reports, writes nothing
 *   pnpm attendance:repair --apply              # repairs
 *   options: --company <uuid>  --from YYYY-MM-DD  --to YYYY-MM-DD
 *
 * A record is flagged when (a) its stored sessionCount differs from the actual session count, or
 * (b) it was calculated (more than a minute) before the latest session / event / approved correction
 * for that employee and date. Records in CLOSED periods are never touched. No record is created or
 * deleted. Idempotent: a repaired record no longer matches, so a second run reports nothing to do.
 * Note: a flagged record is recalculated with TODAY's policy and day context, like any recalculation.
 */

/** Tolerance for clock differences between the app server (calculatedAt) and the database (created_at). */
const ACTIVITY_TOLERANCE_SECONDS = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type Candidate = { company_id: string; employee_id: string; work_date: string; session_count: number; actual_sessions: number };

async function main() {
  const { host } = assertSafeDatabaseTarget({
    purpose: "attendance daily record repair",
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    allowedRemoteHost: process.env.REPAIR_ALLOW_REMOTE_HOST,
    overrideVariable: "REPAIR_ALLOW_REMOTE_HOST",
    remoteRefusal: "Repairing a remote database requires explicit confirmation.",
  });

  const apply = process.argv.includes("--apply");
  const company = argValue("--company");
  const from = argValue("--from");
  const to = argValue("--to");
  if (company && !UUID.test(company)) throw new Error("--company must be a UUID.");
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new Error("--from/--to must be YYYY-MM-DD.");

  console.log(`Repair target host: ${host}`);
  console.log(apply ? "Mode: APPLY (records will be recalculated)" : "Mode: DRY RUN (no writes) — pass --apply to repair");

  const filters = sql`
    ${company ? sql`and r.company_id = ${company}::uuid` : sql``}
    ${from ? sql`and r.work_date >= ${from}::date` : sql``}
    ${to ? sql`and r.work_date <= ${to}::date` : sql``}`;

  const inspectedResult = await db.execute<{ n: number }>(sql`select count(*)::int as n from attendance_daily_records r where true ${filters}`);
  const inspected = inspectedResult.rows[0]?.n ?? 0;

  const candidates = (
    await db.execute<Candidate>(sql`
      select t.company_id, t.employee_id, t.work_date, t.session_count, t.actual_sessions
      from (
        select r.company_id, r.employee_id, r.work_date::text as work_date, r.session_count, r.calculated_at,
          (select count(*)::int from attendance_open_sessions s where s.employee_id = r.employee_id and s.work_date = r.work_date) as actual_sessions,
          greatest(
            (select max(s.updated_at) from attendance_open_sessions s where s.employee_id = r.employee_id and s.work_date = r.work_date),
            (select max(e.created_at) from attendance_events e where e.employee_id = r.employee_id and e.work_date = r.work_date),
            (select max(c.reviewed_at) from attendance_corrections c where c.employee_id = r.employee_id and c.work_date = r.work_date and c.status = 'APPROVED')
          ) as last_activity
        from attendance_daily_records r
        where true ${filters}
      ) t
      where t.actual_sessions <> t.session_count
         or (t.last_activity is not null and t.last_activity - make_interval(secs => ${ACTIVITY_TOLERANCE_SECONDS}) > t.calculated_at)
      order by t.work_date, t.employee_id`)
  ).rows;

  const stats = { inspected, inconsistent: candidates.length, eligible: 0, repaired: 0, skipped_closed: 0, errors: 0 };

  const closedCache = new Map<string, boolean>();
  for (const candidate of candidates) {
    const month = candidate.work_date.slice(0, 7);
    const key = `${candidate.company_id}|${month}`;
    if (!closedCache.has(key)) {
      closedCache.set(key, (await attendancePeriodRepository.findByCompanyAndMonth(candidate.company_id, month))?.status === "CLOSED");
    }
    if (closedCache.get(key)) {
      stats.skipped_closed += 1;
      continue;
    }
    stats.eligible += 1;
    console.log(
      `${apply ? "repair" : "would repair"}: employee ${candidate.employee_id} on ${candidate.work_date} (stored sessions ${candidate.session_count}, actual ${candidate.actual_sessions})`,
    );
    if (!apply) continue;

    try {
      const outcome = await recalculateExistingDailyRecordForRepair(candidate.company_id, candidate.employee_id, candidate.work_date);
      if (outcome === "REPAIRED") stats.repaired += 1;
      else if (outcome === "SKIPPED_CLOSED") {
        // Closed between the read and the repair: it was counted eligible above, so move it.
        stats.eligible -= 1;
        stats.skipped_closed += 1;
      }
    } catch (error) {
      stats.errors += 1;
      console.error(`error: employee ${candidate.employee_id} on ${candidate.work_date}:`, error instanceof Error ? error.message : error);
    }
  }
  console.log(JSON.stringify(stats, null, 2));
  await pool.end();
  if (stats.errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Attendance repair failed:", err);
  process.exit(1);
});
