import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { AppError, InternalError, NotFoundError, ResourceHiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** The `x-request-id` the proxy stamped on this request, or null when there is no request scope (tests, scripts). */
async function requestIdFromProxy(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id");
  } catch {
    return null;
  }
}

export function newRequestId(): string {
  return randomUUID();
}

export function apiSuccess<T>(data: T, init?: { status?: number; requestId?: string }) {
  return NextResponse.json({ data }, { status: init?.status ?? 200 });
}

/** The one 404 body, used for a missing resource AND for one the caller may not know exists (F-24). */
const NOT_FOUND_MESSAGE = "The requested resource was not found.";

export function apiError(error: unknown, requestId: string) {
  // F-24: identical status, code and message for "does not exist" and "exists but is hidden from you", so the
  // response cannot be used to enumerate other companies' (or other teams') records.
  if (error instanceof ResourceHiddenError || error instanceof NotFoundError) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: NOT_FOUND_MESSAGE, requestId } }, { status: 404 });
  }
  if (error instanceof AppError) {
    if (error.httpStatus >= 500) {
      logger.error({ err: error, requestId, code: error.code }, error.message);
    }
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.httpStatus },
    );
  }

  logger.error({ err: error, requestId }, "Unhandled error in API route");
  const internal = new InternalError();
  return NextResponse.json(
    { error: { code: internal.code, message: internal.message, requestId } },
    { status: internal.httpStatus },
  );
}

/**
 * Wraps a route handler so every thrown AppError (or unexpected error) is converted into the
 * standard `{ error: { code, message, requestId } }` envelope instead of leaking stack traces
 * or raw database errors to the client.
 */
export function withApiHandler<Args extends unknown[]>(
  handler: (requestId: string, ...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    // F-15: reuse the id the proxy stamped on the request (it is what audit rows and request logs carry), so
    // the id in an error response can be traced to its audit trail. A fresh one only when there is none.
    const requestId = (await requestIdFromProxy()) ?? newRequestId();
    try {
      return await handler(requestId, ...args);
    } catch (error) {
      return apiError(error, requestId);
    }
  };
}
