import { z } from "zod";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { listAttendanceProcessingRuns, MAX_RUN_HISTORY_PAGE_SIZE } from "@/domains/attendance/processing/attendance-auto-processing.service";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_RUN_HISTORY_PAGE_SIZE).default(20),
});

/** Recent automated processing runs for the caller's own company, newest first. */
export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("Invalid pagination parameters.", parsed.error.flatten());
  }
  return apiSuccess(await listAttendanceProcessingRuns(ctx, parsed.data));
});
