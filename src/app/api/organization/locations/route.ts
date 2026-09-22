import { apiSuccess, withApiHandler } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/auth/request-context";
import { createLocationSchema } from "@/validations/organization";
import { createLocation, listLocations } from "@/domains/organization/service";

export const GET = withApiHandler(async () => {
  const ctx = await getRequestContext();
  const locations = await listLocations(ctx);
  return apiSuccess(locations);
});

export const POST = withApiHandler(async (_requestId, request: Request) => {
  const ctx = await getRequestContext();
  const body = await request.json().catch(() => null);
  const parsed = createLocationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid location data.", parsed.error.flatten());
  }
  const location = await createLocation(ctx, parsed.data);
  return apiSuccess(location, { status: 201 });
});
