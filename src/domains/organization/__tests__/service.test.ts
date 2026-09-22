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
  let CircularDepartmentHierarchyError: typeof import("../errors").CircularDepartmentHierarchyError;

  let companyId: string;
  let userId: string;
  let ctx: import("@/lib/auth/request-context").RequestContext;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    service = await import("../service");
    ({ DuplicateCodeError, BranchNotFoundError, CircularDepartmentHierarchyError } = await import("../errors"));

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

  it("updates a branch's address fields and archives/restores it", async () => {
    const branch = await service.createBranch(ctx, { name: "Archivable Branch", code: "ARCHB" });
    const updated = await service.updateBranch(ctx, branch.id, { city: "Dubai", country: "AE" });
    expect(updated.city).toBe("Dubai");
    expect(updated.country).toBe("AE");

    const archived = await service.setBranchActive(ctx, branch.id, false);
    expect(archived.isActive).toBe(false);

    const restored = await service.setBranchActive(ctx, branch.id, true);
    expect(restored.isActive).toBe(true);
  });

  it("creates and lists a designation scoped to the caller's company", async () => {
    const designation = await service.createDesignation(ctx, { name: "Software Engineer", code: "ENG-SWE", level: 2 });
    expect(designation.companyId).toBe(companyId);

    const designations = await service.listDesignations(ctx);
    expect(designations.map((d) => d.id)).toContain(designation.id);
  });

  it("rejects a duplicate designation code within the same company", async () => {
    await service.createDesignation(ctx, { name: "Dup Designation 1", code: "DUPDESIG" });
    await expect(
      service.createDesignation(ctx, { name: "Dup Designation 2", code: "DUPDESIG" }),
    ).rejects.toBeInstanceOf(DuplicateCodeError);
  });

  it("updates and archives/restores a designation", async () => {
    const designation = await service.createDesignation(ctx, { name: "Archivable Designation", code: "ARCHDESIG" });
    const updated = await service.updateDesignation(ctx, designation.id, { level: 5 });
    expect(updated.level).toBe(5);

    const archived = await service.setDesignationActive(ctx, designation.id, false);
    expect(archived.isActive).toBe(false);
    const restored = await service.setDesignationActive(ctx, designation.id, true);
    expect(restored.isActive).toBe(true);
  });

  it("creates a child department and updates its parent", async () => {
    const parent = await service.createDepartment(ctx, { name: "Engineering", code: "ENG-PARENT" });
    const child = await service.createDepartment(ctx, {
      name: "Platform Engineering",
      code: "ENG-PLAT",
      parentDepartmentId: parent.id,
    });
    expect(child.parentDepartmentId).toBe(parent.id);

    const reparented = await service.updateDepartment(ctx, child.id, { parentDepartmentId: null });
    expect(reparented.parentDepartmentId).toBeNull();
  });

  it("rejects a department becoming its own parent", async () => {
    const department = await service.createDepartment(ctx, { name: "Self Parent Dept", code: "SELFPARENT" });
    await expect(
      service.updateDepartment(ctx, department.id, { parentDepartmentId: department.id }),
    ).rejects.toBeInstanceOf(CircularDepartmentHierarchyError);
  });

  it("rejects a circular department hierarchy (grandparent set as its own grandchild's parent)", async () => {
    const grandparent = await service.createDepartment(ctx, { name: "Grandparent Dept", code: "GRANDP" });
    const parent = await service.createDepartment(ctx, {
      name: "Parent Dept",
      code: "PARENTD",
      parentDepartmentId: grandparent.id,
    });
    const child = await service.createDepartment(ctx, {
      name: "Child Dept",
      code: "CHILDD",
      parentDepartmentId: parent.id,
    });

    await expect(
      service.updateDepartment(ctx, grandparent.id, { parentDepartmentId: child.id }),
    ).rejects.toBeInstanceOf(CircularDepartmentHierarchyError);
  });

  it("updates and archives/restores a department", async () => {
    const department = await service.createDepartment(ctx, { name: "Archivable Dept", code: "ARCHDEPT" });
    const updated = await service.updateDepartment(ctx, department.id, { description: "Updated description" });
    expect(updated.description).toBe("Updated description");

    const archived = await service.setDepartmentActive(ctx, department.id, false);
    expect(archived.isActive).toBe(false);
    const restored = await service.setDepartmentActive(ctx, department.id, true);
    expect(restored.isActive).toBe(true);
  });
});
