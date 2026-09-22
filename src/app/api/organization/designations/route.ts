import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createDesignationSchema } from "@/validations/organization";
import { createDesignation, listDesignations } from "@/domains/organization/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const designations = await listDesignations(ctx);
  return apiSuccess(designations);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createDesignationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid designation data.", parsed.error.flatten());
  }
  const designation = await createDesignation(ctx, parsed.data);
  return apiSuccess(designation, { status: 201 });
});
