import { z } from "zod";
import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { getOrgChartSubtree } from "@/domains/employee/service";

const querySchema = z.object({ managerId: z.uuid().optional() });

export const GET = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const searchParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(searchParams);
  if (!parsed.success) {
    throw new ValidationError("Invalid query parameters.", parsed.error.flatten());
  }
  const nodes = await getOrgChartSubtree(ctx, parsed.data.managerId ?? null);
  return apiSuccess(nodes);
});
