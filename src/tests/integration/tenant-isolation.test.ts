import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../setup/db";

const available = await isDatabaseAvailable();

describe.skipIf(!available)("critical security invariant: tenant isolation", () => {
  // Dynamic imports so this file never touches `@/db/client` (and therefore never requires
  // DATABASE_URL to be valid) when the suite is skipped.
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let orgService: typeof import("@/domains/organization/service");
  let employeeService: typeof import("@/domains/employee/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;

  let companyAId: string;
  let companyBId: string;
  let departmentAId: string;
  let employeeAId: string;
  let adminAUserId: string;
  let ctxCompanyAAdmin: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyBAdmin: import("@/lib/auth/request-context").RequestContext;
  let ctxCompanyAEmployee: import("@/lib/auth/request-context").RequestContext;

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    orgService = await import("@/domains/organization/service");
    employeeService = await import("@/domains/employee/service");
    ({ AuthorizationError } = await import("@/lib/errors"));

    const [companyA] = await db
      .insert(schema.companies)
      .values({ name: "Tenant Test Co A", code: `TEST_A_${Date.now()}` })
      .returning();
    const [companyB] = await db
      .insert(schema.companies)
      .values({ name: "Tenant Test Co B", code: `TEST_B_${Date.now()}` })
      .returning();
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    // A real row so the audit log FK on actor_user_id resolves (this context performs a write).
    const [adminAUser] = await db
      .insert(schema.users)
      .values({ email: `admin-a-${Date.now()}@test.local`, passwordHash: "unused", fullName: "Admin A" })
      .returning();
    adminAUserId = adminAUser!.id;

    ctxCompanyAAdmin = {
      requestId: "test-request-a",
      userId: adminAUserId,
      userEmail: "admin-a@test.local",
      companyId: companyAId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    ctxCompanyBAdmin = {
      requestId: "test-request-b",
      userId: "00000000-0000-0000-0000-000000000002",
      userEmail: "admin-b@test.local",
      companyId: companyBId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    ctxCompanyAEmployee = {
      requestId: "test-request-c",
      userId: "00000000-0000-0000-0000-000000000003",
      userEmail: "employee-a@test.local",
      companyId: companyAId,
      role: "EMPLOYEE",
      employeeId: null,
    };

    const department = await orgService.createDepartment(ctxCompanyAAdmin, {
      name: "Company A Only Department",
      code: "CONFIDENTIAL",
    });
    departmentAId = department.id;

    const employee = await employeeService.createEmployee(ctxCompanyAAdmin, {
      firstName: "Confidential",
      lastName: "Employee",
      workEmail: `confidential-${Date.now()}@test.local`,
      dateOfJoining: "2026-01-01",
      departmentId: departmentAId,
    });
    employeeAId = employee.id;
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyAId));
    await db.delete(schema.companies).where(eq(schema.companies.id, companyBId));
    await db.delete(schema.users).where(eq(schema.users.id, adminAUserId));
    await pool.end();
  });

  it("blocks a Company B admin from reading a Company A department by id", async () => {
    await expect(orgService.getDepartment(ctxCompanyBAdmin, departmentAId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("allows the owning company's admin to read the same department", async () => {
    const department = await orgService.getDepartment(ctxCompanyAAdmin, departmentAId);
    expect(department.id).toBe(departmentAId);
  });

  it("scopes list queries to the caller's own company", async () => {
    const companyBDepartments = await orgService.listDepartments(ctxCompanyBAdmin);
    expect(companyBDepartments.find((d) => d.id === departmentAId)).toBeUndefined();
  });

  it("rejects insufficient permission (EMPLOYEE cannot manage organization data)", async () => {
    await expect(
      orgService.createDepartment(ctxCompanyAEmployee, { name: "Should Fail", code: "NOPE" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("blocks a Company B admin from reading a Company A employee by id", async () => {
    await expect(employeeService.getEmployee(ctxCompanyBAdmin, employeeAId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("scopes employee list queries to the caller's own company", async () => {
    const result = await employeeService.listEmployees(ctxCompanyBAdmin, { page: 1, pageSize: 25 });
    expect(result.items.find((e) => e.id === employeeAId)).toBeUndefined();
  });

  it("blocks a Company B admin from reading a Company A employee's history", async () => {
    await expect(employeeService.listEmployeeHistory(ctxCompanyBAdmin, employeeAId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("blocks a Company B admin from expanding a Company A employee's org chart subtree", async () => {
    await expect(employeeService.getOrgChartSubtree(ctxCompanyBAdmin, employeeAId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("scopes the org chart top level to the caller's own company", async () => {
    const companyBTopLevel = await employeeService.getOrgChartSubtree(ctxCompanyBAdmin, null);
    expect(companyBTopLevel.find((n) => n.id === employeeAId)).toBeUndefined();
  });
});
