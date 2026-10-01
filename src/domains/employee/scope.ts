/**
 * F-02 - reporting-line scope. A line MANAGER may see and act on THEMSELVES and the people who report to
 * them, directly or through other managers (`employees.manager_id`), inside their own company - not the
 * whole company. Every other role keeps its existing, permission-based, company-wide reach, so this
 * module narrows only the MANAGER role and grants nothing to anyone.
 *
 * `getEmployeeScope` is the single place the rule lives; services call it (or `assertEmployeeInScope`)
 * right after the company check. Aggregated counts (e.g. the employee/workforce dashboard tiles) are
 * not per-person data and are not scoped here.
 */
import type { RequestContext } from "@/lib/auth/request-context";
import { ResourceHiddenError } from "@/lib/errors";
import { employeeRepository } from "./repository";

/** `null` = unrestricted (every role except MANAGER). For a MANAGER: their own employee id plus every
 *  non-archived employee below them in the reporting line. A MANAGER account with no linked employee
 *  record has an empty scope. */
export async function getEmployeeScope(ctx: RequestContext): Promise<ReadonlySet<string> | null> {
  if (ctx.role !== "MANAGER") return null;
  if (!ctx.employeeId) return new Set();
  const team = await employeeRepository.listTeamIds(ctx.companyId, ctx.employeeId);
  return new Set([ctx.employeeId, ...team]);
}

export async function assertEmployeeInScope(ctx: RequestContext, employeeId: string): Promise<void> {
  const scope = await getEmployeeScope(ctx);
  if (scope && !scope.has(employeeId)) {
    throw new ResourceHiddenError("This employee is outside your team.");
  }
}
