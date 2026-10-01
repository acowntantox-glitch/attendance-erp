import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("storage: the upload URL is bound to what the server approved", () => {
  it("signs Content-Type and Content-Length, so the bucket rejects a different type or size", async () => {
    vi.stubEnv("S3_BUCKET", "test-bucket");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIATESTTESTTESTTEST");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-test-secret-test-secret");
    vi.resetModules();
    const { getUploadUrl } = await import("../index");

    const url = new URL(await getUploadUrl("companies/c/employees/e/documents/d-file.pdf", "application/pdf", 1234));
    const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signedHeaders).toContain("content-type");
    expect(signedHeaders).toContain("content-length");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300"); // short-lived
  });
});
