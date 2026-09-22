import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createBranchSchema } from "@/validations/organization";
import { createBranch, listBranches } from "@/domains/organization/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const branches = await listBranches(ctx);
  return apiSuccess(branches);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createBranchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid branch data.", parsed.error.flatten());
  }
  const branch = await createBranch(ctx, parsed.data);
  return apiSuccess(branch, { status: 201 });
});
