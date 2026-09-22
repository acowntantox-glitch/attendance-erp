import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "./index";

describe("AppError taxonomy", () => {
  it("maps ValidationError to 400/VALIDATION_ERROR", () => {
    const error = new ValidationError("bad input");
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.httpStatus).toBe(400);
  });

  it("maps AuthenticationError to 401/UNAUTHORIZED", () => {
    const error = new AuthenticationError();
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.httpStatus).toBe(401);
  });

  it("maps AuthorizationError to 403/FORBIDDEN", () => {
    const error = new AuthorizationError();
    expect(error.code).toBe("FORBIDDEN");
    expect(error.httpStatus).toBe(403);
  });

  it("maps NotFoundError to 404/NOT_FOUND", () => {
    const error = new NotFoundError("Company");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.httpStatus).toBe(404);
    expect(error.message).toContain("Company");
  });

  it("maps ConflictError to 409/CONFLICT", () => {
    const error = new ConflictError();
    expect(error.code).toBe("CONFLICT");
    expect(error.httpStatus).toBe(409);
  });
});
