import { beforeEach, describe, expect, it, vi } from "vitest";

// Set before any module reads the environment (vi.hoisted runs ahead of the imports below).
const SECRETS = vi.hoisted(() => {
  const secrets = { internal: "job-secret-".padEnd(48, "x"), cron: "cron-secret-".padEnd(24, "y") };
  process.env.INTERNAL_JOB_SECRET = secrets.internal;
  process.env.CRON_SECRET = secrets.cron;
  return secrets;
});

const runScheduledAttendanceProcessing = vi.fn();

vi.mock("@/domains/attendance/processing/attendance-auto-processing.service", () => ({
  runScheduledAttendanceProcessing: (...args: unknown[]) => runScheduledAttendanceProcessing(...args),
}));

const route = await import("./route");

function request(method: "GET" | "POST", headers: Record<string, string> = {}, body?: unknown) {
  return new Request("http://localhost/api/internal/jobs/attendance-daily", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

describe("attendance-daily job endpoint", () => {
  beforeEach(() => {
    runScheduledAttendanceProcessing.mockReset();
    runScheduledAttendanceProcessing.mockResolvedValue({
      companiesProcessed: 1,
      companiesFailed: 0,
      created: 2,
      skipped: 0,
      failed: 0,
      stoppedEarly: false,
      companies: [],
    });
  });

  describe.each(["GET", "POST"] as const)("%s", (method) => {
    const call = (headers?: Record<string, string>, body?: unknown) => route[method](request(method, headers, body));

    it("rejects a request with no secret, without running the job", async () => {
      const response = await call();
      expect(response.status).toBe(401);
      expect(runScheduledAttendanceProcessing).not.toHaveBeenCalled();
    });

    it("rejects an incorrect secret, without running the job or echoing any secret", async () => {
      const response = await call(bearer("not-the-secret"));
      expect(response.status).toBe(401);
      expect(runScheduledAttendanceProcessing).not.toHaveBeenCalled();
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain(SECRETS.internal);
      expect(text).not.toContain(SECRETS.cron);
    });

    it("rejects a secret in the wrong place (query string / non-bearer header)", async () => {
      const inQuery = await route[method](new Request(`http://localhost/api/internal/jobs/attendance-daily?secret=${SECRETS.internal}`, { method }));
      expect(inQuery.status).toBe(401);
      const basic = await call({ authorization: `Basic ${SECRETS.internal}` });
      expect(basic.status).toBe(401);
      expect(runScheduledAttendanceProcessing).not.toHaveBeenCalled();
    });

    it("accepts the INTERNAL_JOB_SECRET", async () => {
      const response = await call(bearer(SECRETS.internal));
      expect(response.status).toBe(200);
      expect(runScheduledAttendanceProcessing).toHaveBeenCalledTimes(1);
    });

    it("accepts the CRON_SECRET (what Vercel Cron sends) and never leaks either secret", async () => {
      const response = await call(bearer(SECRETS.cron));
      expect(response.status).toBe(200);
      expect(runScheduledAttendanceProcessing).toHaveBeenCalledTimes(1);
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain(SECRETS.internal);
      expect(text).not.toContain(SECRETS.cron);
    });

    it("ignores any company, user or budget supplied by the caller: only the server-side budget is passed", async () => {
      await call({ ...bearer(SECRETS.cron), "x-company-id": "evil" }, method === "POST" ? { companyId: "evil", companyIds: ["evil"], timeBudgetMs: 999_999_999 } : undefined);
      expect(runScheduledAttendanceProcessing).toHaveBeenCalledTimes(1);
      const [options] = runScheduledAttendanceProcessing.mock.calls[0]!;
      expect(Object.keys(options as object)).toEqual(["timeBudgetMs"]);
      expect((options as { timeBudgetMs: number }).timeBudgetMs).toBe(45_000);
    });
  });

  it("exports only GET and POST, so every other method is answered 405 by Next.js", () => {
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect((route as Record<string, unknown>)[method]).toBeUndefined();
    }
  });

  it("declares an execution limit and a time budget safely inside it", () => {
    expect(route.maxDuration).toBe(60);
    expect(route.dynamic).toBe("force-dynamic");
  });
});
