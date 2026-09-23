import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getWorkforceDayInfo, getWorkforceDayInfoRange } from "@/domains/workforce/service";

const dateParam = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Two modes on one route, matching how this resource is actually used: `date` for a single day
 * (unchanged from the original single-day endpoint), or `from`+`to` for a calendar range (e.g. a
 * month grid). Both ultimately call the same `getWorkforceDayInfo` — the range mode just loops it
 * via `getWorkforceDayInfoRange`, so there is one precedence implementation either way.
 */
export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const date = url.searchParams.get("date");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!employeeId) {
    throw new ValidationError("Query param 'employeeId' is required.");
  }

  if (from || to) {
    if (!from || !to || !dateParam.test(from) || !dateParam.test(to)) {
      throw new ValidationError("Query params 'from' and 'to' (YYYY-MM-DD) are both required for a range request.");
    }
    const range = await getWorkforceDayInfoRange(ctx, employeeId, from, to);
    return apiSuccess(range);
  }

  if (!date || !dateParam.test(date)) {
    throw new ValidationError("Query param 'date' (YYYY-MM-DD) is required, or use 'from'/'to' for a range.");
  }
  const dayInfo = await getWorkforceDayInfo(ctx, employeeId, date);
  return apiSuccess(dayInfo);
});
