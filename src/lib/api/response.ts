import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, InternalError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export function newRequestId(): string {
  return randomUUID();
}

export function apiSuccess<T>(data: T, init?: { status?: number; requestId?: string }) {
  return NextResponse.json({ data }, { status: init?.status ?? 200 });
}

export function apiError(error: unknown, requestId: string) {
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
    const requestId = newRequestId();
    try {
      return await handler(requestId, ...args);
    } catch (error) {
      return apiError(error, requestId);
    }
  };
}
