import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createHolidaySchema } from "@/validations/workforce";
import { createHoliday, listHolidays } from "@/domains/workforce/service";

const dateParam = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !dateParam.test(from) || !dateParam.test(to)) {
    throw new ValidationError("Query params 'from' and 'to' (YYYY-MM-DD) are required.");
  }
  const holidays = await listHolidays(ctx, from, to);
  return apiSuccess(holidays);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createHolidaySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid holiday data.", parsed.error.flatten());
  }
  const holiday = await createHoliday(ctx, parsed.data);
  return apiSuccess(holiday, { status: 201 });
});
