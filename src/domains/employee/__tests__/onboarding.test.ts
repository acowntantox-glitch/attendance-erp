import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

describe.skipIf(!available)("employee onboarding", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let service: typeof import("../service");
  let OnboardingNotFoundError: typeof import("../errors").OnboardingNotFoundError;

  let companyId: string;
  let userId: string;
  let employeeId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    service = await import("../service");
    ({ OnboardingNotFoundError } = await import("../errors"));

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "Onboarding Test Co", code: `ONB_TEST_${Date.now()}` })
      .returning();
    companyId = company!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `admin-${Date.now()}@onboarding-test.local`, passwordHash: "unused", fullName: "Onboarding Test Admin" })
      .returning();
    userId = user!.id;

    ctx = {
      requestId: "onboarding-test",
      userId,
      userEmail: user!.email,
      companyId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };

    const employee = await service.createEmployee(ctx, {
      firstName: "Onboarding",
      lastName: "Subject",
      workEmail: `onboarding-${Date.now()}@onboarding-test.local`,
      dateOfJoining: "2026-01-01",
    });
    employeeId = employee.id;
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await pool.end();
  });

  it("returns null onboarding before it's started", async () => {
    const onboarding = await service.getOnboarding(ctx, employeeId);
    expect(onboarding).toBeNull();
  });

  it("starts onboarding with the default task checklist and moves the employee to IN_PROGRESS", async () => {
    const onboarding = await service.startOnboarding(ctx, employeeId);
    expect(onboarding.tasks.length).toBeGreaterThan(0);
    expect(onboarding.tasks.every((t) => !t.isCompleted)).toBe(true);

    const employee = await service.getEmployee(ctx, employeeId);
    expect(employee.onboardingStatus).toBe("IN_PROGRESS");
  });

  it("is idempotent — starting onboarding twice returns the same record", async () => {
    const first = await service.startOnboarding(ctx, employeeId);
    const second = await service.startOnboarding(ctx, employeeId);
    expect(second.id).toBe(first.id);
  });

  it("completing every task moves onboarding (and the employee) to COMPLETED", async () => {
    const onboarding = await service.getOnboarding(ctx, employeeId);
    for (const task of onboarding!.tasks) {
      await service.updateOnboardingTask(ctx, employeeId, task.id, true);
    }

    const employee = await service.getEmployee(ctx, employeeId);
    expect(employee.onboardingStatus).toBe("COMPLETED");
  });

  it("un-completing a task after full completion moves the employee back to IN_PROGRESS", async () => {
    const onboarding = await service.getOnboarding(ctx, employeeId);
    const firstTask = onboarding!.tasks[0]!;
    await service.updateOnboardingTask(ctx, employeeId, firstTask.id, false);

    const employee = await service.getEmployee(ctx, employeeId);
    expect(employee.onboardingStatus).toBe("IN_PROGRESS");
  });

  it("rejects toggling a task id that doesn't belong to this employee's onboarding", async () => {
    await expect(
      service.updateOnboardingTask(ctx, employeeId, "00000000-0000-0000-0000-000000000000", true),
    ).rejects.toBeInstanceOf(OnboardingNotFoundError);
  });
});
