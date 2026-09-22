import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

describe.skipIf(!available)("organization service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let service: typeof import("../service");
  let DuplicateCodeError: typeof import("../errors").DuplicateCodeError;
  let BranchNotFoundError: typeof import("../errors").BranchNotFoundError;

  let companyId: string;
  let userId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    service = await import("../service");
    ({ DuplicateCodeError, BranchNotFoundError } = await import("../errors"));

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "Org Service Test Co", code: `ORG_TEST_${Date.now()}` })
      .returning();
    companyId = company!.id;

    // A real row so the audit log FK on actor_user_id resolves (create* calls below write audit logs).
    const [user] = await db
      .insert(schema.users)
      .values({ email: `admin-${Date.now()}@org-test.local`, passwordHash: "unused", fullName: "Org Test Admin" })
      .returning();
    userId = user!.id;

    ctx = {
      requestId: "org-test",
      userId,
      userEmail: user!.email,
      companyId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await pool.end();
  });

  it("creates and lists a branch scoped to the caller's company", async () => {
    const branch = await service.createBranch(ctx, { name: "Main Branch", code: "MAIN" });
    expect(branch.companyId).toBe(companyId);

    const branches = await service.listBranches(ctx);
    expect(branches.map((b) => b.id)).toContain(branch.id);
  });

  it("rejects a duplicate branch code within the same company", async () => {
    await service.createBranch(ctx, { name: "Dup 1", code: "DUP" });
    await expect(service.createBranch(ctx, { name: "Dup 2", code: "DUP" })).rejects.toBeInstanceOf(
      DuplicateCodeError,
    );
  });

  it("throws BranchNotFoundError for an unknown branch id", async () => {
    await expect(service.getBranch(ctx, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
      BranchNotFoundError,
    );
  });

  it("creates a location tied to an existing branch", async () => {
    const branch = await service.createBranch(ctx, { name: "Loc Branch", code: "LOCB" });
    const location = await service.createLocation(ctx, {
      branchId: branch.id,
      name: "Test Location",
      latitude: 25.2,
      longitude: 55.27,
    });
    expect(location.branchId).toBe(branch.id);
    expect(location.companyId).toBe(companyId);
  });
});
