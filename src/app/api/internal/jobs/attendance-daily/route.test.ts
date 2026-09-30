import { beforeEach, describe, expect, it, vi } from "vitest";

// Set before any module reads the environment (vi.hoisted runs ahead of the imports below).
const SECRET = vi.hoisted(() => {
  const secret = "job-secret-".padEnd(48, "x");
  process.env.INTERNAL_JOB_SECRET = secret;
  return secret;
});

const runScheduledAttendanceProcessing = vi.fn();

vi.mock("@/domains/attendance/processing/attendance-auto-processing.service", () => ({
  runScheduledAttendanceProcessing: (...args: unknown[]) => runScheduledAttendanceProcessing(...args),
}));

const { POST } = await import("./route");

function request(headers: Record<string, string> = {}, body?: unknown) {
  return new Request("http://localhost/api/internal/jobs/attendance-daily", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/internal/jobs/attendance-daily", () => {
  beforeEach(() => {
    runScheduledAttendanceProcessing.mockReset();
    runScheduledAttendanceProcessing.mockResolvedValue({ companiesProcessed: 1, companiesFailed: 0, created: 2, skipped: 0, failed: 0, companies: [] });
  });

  it("rejects a request with no secret, without running the job", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(runScheduledAttendanceProcessing).not.toHaveBeenCalled();
  });

  it("rejects an invalid secret, without running the job or echoing anything secret", async () => {
    const response = await POST(request({ authorization: "Bearer not-the-secret" }));
    expect(response.status).toBe(401);
    expect(runScheduledAttendanceProcessing).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(SECRET);
  });

  it("accepts the valid secret and never leaks it in the response", async () => {
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    expect(runScheduledAttendanceProcessing).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await response.json())).not.toContain(SECRET);
  });

  it("ignores any company or user supplied by the caller: the job is invoked with no arguments", async () => {
    await POST(request({ authorization: `Bearer ${SECRET}`, "x-company-id": "evil" }, { companyId: "evil", companyIds: ["evil"], userId: "evil" }));
    expect(runScheduledAttendanceProcessing).toHaveBeenCalledWith();
  });
});
