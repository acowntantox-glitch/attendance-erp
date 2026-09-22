import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { isDatabaseAvailable } from "../../../tests/setup/db";

const available = await isDatabaseAvailable();

describe.skipIf(!available)("employee service", () => {
  let db: typeof import("@/db/client").db;
  let pool: typeof import("@/db/client").pool;
  let schema: typeof import("@/db/schema");
  let service: typeof import("../service");
  let orgService: typeof import("@/domains/organization/service");
  let AuthorizationError: typeof import("@/lib/errors").AuthorizationError;
  let DuplicateWorkEmailError: typeof import("../errors").DuplicateWorkEmailError;
  let SelfManagerError: typeof import("../errors").SelfManagerError;
  let CircularManagerHierarchyError: typeof import("../errors").CircularManagerHierarchyError;
  let EmployeeHasActiveDirectReportsError: typeof import("../errors").EmployeeHasActiveDirectReportsError;

  let companyId: string;
  let adminUserId: string;
  let departmentId: string;
  let designationId: string;
  let branchId: string;
  let adminCtx: import("@/lib/auth/request-context").RequestContext;
  let managerCtx: import("@/lib/auth/request-context").RequestContext;

  function baseInput(overrides: Partial<import("../model").CreateEmployeeInput> = {}) {
    return {
      firstName: "Test",
      lastName: `Employee-${Math.random().toString(36).slice(2, 8)}`,
      workEmail: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@employee-test.local`,
      dateOfJoining: "2026-01-01",
      departmentId,
      designationId,
      locationId: branchId,
      ...overrides,
    };
  }

  beforeAll(async () => {
    ({ db, pool } = await import("@/db/client"));
    schema = await import("@/db/schema");
    service = await import("../service");
    orgService = await import("@/domains/organization/service");
    ({ AuthorizationError } = await import("@/lib/errors"));
    ({ DuplicateWorkEmailError, SelfManagerError, CircularManagerHierarchyError, EmployeeHasActiveDirectReportsError } =
      await import("../errors"));

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "Employee Service Test Co", code: `EMP_TEST_${Date.now()}` })
      .returning();
    companyId = company!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `admin-${Date.now()}@employee-test.local`, passwordHash: "unused", fullName: "Employee Test Admin" })
      .returning();
    adminUserId = user!.id;

    adminCtx = {
      requestId: "employee-test-admin",
      userId: adminUserId,
      userEmail: user!.email,
      companyId,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    managerCtx = { ...adminCtx, requestId: "employee-test-manager", role: "MANAGER" };

    const department = await orgService.createDepartment(adminCtx, { name: "Engineering", code: "EMP_TEST_ENG" });
    departmentId = department.id;
    const designation = await orgService.createDesignation(adminCtx, { name: "Software Engineer", code: "EMP_TEST_SWE" });
    designationId = designation.id;
    const branch = await orgService.createBranch(adminCtx, { name: "HQ", code: "EMP_TEST_HQ" });
    branchId = branch.id;
  });

  afterAll(async () => {
    await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await pool.end();
  });

  it("creates and lists an employee scoped to the caller's company", async () => {
    const employee = await service.createEmployee(adminCtx, baseInput({ lastName: "Creates" }));
    expect(employee.companyId).toBe(companyId);
    expect(employee.employeeNumber).toMatch(/^EMP-\d{5}$/);

    const result = await service.listEmployees(adminCtx, { page: 1, pageSize: 25 });
    expect(result.items.map((e) => e.id)).toContain(employee.id);
  });

  it("rejects a duplicate work email within the same company", async () => {
    const input = baseInput({ lastName: "Dup1" });
    await service.createEmployee(adminCtx, input);
    await expect(
      service.createEmployee(adminCtx, { ...baseInput({ lastName: "Dup2" }), workEmail: input.workEmail }),
    ).rejects.toBeInstanceOf(DuplicateWorkEmailError);
  });

  it("generates distinct, sequential employee numbers under concurrent creates", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => service.createEmployee(adminCtx, baseInput({ lastName: `Concurrent${i}` }))),
    );
    const numbers = results.map((e) => e.employeeNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("rejects an employee being set as their own manager", async () => {
    const employee = await service.createEmployee(adminCtx, baseInput({ lastName: "SelfManager" }));
    await expect(
      service.updateEmployee(adminCtx, employee.id, { managerId: employee.id }),
    ).rejects.toBeInstanceOf(SelfManagerError);
  });

  it("rejects a circular manager chain", async () => {
    const a = await service.createEmployee(adminCtx, baseInput({ lastName: "ChainA" }));
    const b = await service.createEmployee(adminCtx, baseInput({ lastName: "ChainB", managerId: a.id }));
    // a currently has no manager; try to make a report to b, which would close a cycle a -> b -> a
    await expect(service.updateEmployee(adminCtx, a.id, { managerId: b.id })).rejects.toBeInstanceOf(
      CircularManagerHierarchyError,
    );
  });

  it("records one structured history row per changed field on update", async () => {
    const manager = await service.createEmployee(adminCtx, baseInput({ lastName: "NewManager" }));
    const employee = await service.createEmployee(adminCtx, baseInput({ lastName: "HistorySubject" }));

    await service.updateEmployee(adminCtx, employee.id, { managerId: manager.id, employmentType: "CONTRACT" });

    const history = await service.listEmployeeHistory(adminCtx, employee.id);
    const eventTypes = history.map((h) => h.eventType);
    expect(eventTypes).toContain("MANAGER_CHANGED");
    expect(eventTypes).toContain("EMPLOYMENT_TYPE_CHANGED");
    expect(eventTypes).toContain("CREATED");
  });

  it("clears a nullable assignment when explicitly set to null, but leaves it unchanged when omitted", async () => {
    const manager = await service.createEmployee(adminCtx, baseInput({ lastName: "ClearManager" }));
    const employee = await service.createEmployee(adminCtx, baseInput({ lastName: "ClearSubject", managerId: manager.id }));
    expect(employee.departmentId).toBe(departmentId);

    // omitted managerId -> unchanged; explicit null departmentId -> cleared
    const updated = await service.updateEmployee(adminCtx, employee.id, { departmentId: null });
    expect(updated.departmentId).toBeNull();
    expect(updated.managerId).toBe(manager.id);

    const history = await service.listEmployeeHistory(adminCtx, employee.id);
    expect(history.map((h) => h.eventType)).toContain("DEPARTMENT_CHANGED");
  });

  it("requires employee.manage_status (not just employee.update) to change employment status", async () => {
    const employee = await service.createEmployee(adminCtx, baseInput({ lastName: "StatusGate" }));

    // managerCtx has employee.update but not employee.manage_status (see rbac.ts) — updating a
    // non-status field succeeds, but changing status must be rejected.
    await expect(service.updateEmployee(managerCtx, employee.id, { phone: "+1000000" })).resolves.toBeDefined();
    await expect(service.changeEmployeeStatus(managerCtx, employee.id, "TERMINATED")).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    const updated = await service.changeEmployeeStatus(adminCtx, employee.id, "TERMINATED");
    expect(updated.employmentStatus).toBe("TERMINATED");
    const history = await service.listEmployeeHistory(adminCtx, employee.id);
    expect(history.map((h) => h.eventType)).toContain("TERMINATED");
  });

  it("blocks archiving a manager with active direct reports, then allows it once reassigned", async () => {
    const manager = await service.createEmployee(adminCtx, baseInput({ lastName: "BlockedManager" }));
    const report = await service.createEmployee(adminCtx, baseInput({ lastName: "Report", managerId: manager.id }));
    const otherManager = await service.createEmployee(adminCtx, baseInput({ lastName: "ReplacementManager" }));

    await expect(service.archiveEmployee(adminCtx, manager.id)).rejects.toBeInstanceOf(
      EmployeeHasActiveDirectReportsError,
    );

    await service.updateEmployee(adminCtx, report.id, { managerId: otherManager.id });
    const archived = await service.archiveEmployee(adminCtx, manager.id);
    expect(archived.isArchived).toBe(true);
  });

  it("rejects reassigning a direct report to a cross-company manager", async () => {
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ name: "Other Co", code: `EMP_OTHER_${Date.now()}` })
      .returning();
    const [otherUser] = await db
      .insert(schema.users)
      .values({ email: `other-${Date.now()}@employee-test.local`, passwordHash: "unused", fullName: "Other Admin" })
      .returning();
    const otherCtx: import("@/lib/auth/request-context").RequestContext = {
      requestId: "other-co",
      userId: otherUser!.id,
      userEmail: otherUser!.email,
      companyId: otherCompany!.id,
      role: "COMPANY_ADMIN",
      employeeId: null,
    };
    const crossCompanyDept = await orgService.createDepartment(otherCtx, { name: "X Dept", code: "XDEPT" });
    const crossCompanyManager = await service.createEmployee(otherCtx, {
      firstName: "Cross",
      lastName: "Manager",
      workEmail: `cross-${Date.now()}@employee-test.local`,
      dateOfJoining: "2026-01-01",
      departmentId: crossCompanyDept.id,
    });

    const employee = await service.createEmployee(adminCtx, baseInput({ lastName: "CrossCoTarget" }));
    await expect(
      service.updateEmployee(adminCtx, employee.id, { managerId: crossCompanyManager.id }),
    ).rejects.toThrow();

    await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany!.id));
    await db.delete(schema.users).where(eq(schema.users.id, otherUser!.id));
  });

  it("allows an employee to view their own record without employee.view, and redacts private fields for others without employee.view_private", async () => {
    const [selfUser] = await db
      .insert(schema.users)
      .values({ email: `self-${Date.now()}@employee-test.local`, passwordHash: "unused", fullName: "Self User" })
      .returning();

    const employee = await service.createEmployee(
      adminCtx,
      baseInput({ lastName: "SelfView", userId: undefined, personalEmail: "private@example.com" }),
    );
    // Link the employee to the user directly (createEmployee's userId path requires an existing
    // company membership, which is out of scope for this fixture — link via a direct update).
    await db.update(schema.employees).set({ userId: selfUser!.id }).where(eq(schema.employees.id, employee.id));

    const selfCtx: import("@/lib/auth/request-context").RequestContext = {
      requestId: "self-view",
      userId: selfUser!.id,
      userEmail: selfUser!.email,
      companyId,
      role: "EMPLOYEE",
      employeeId: employee.id,
    };

    const ownRecord = await service.getEmployee(selfCtx, employee.id);
    expect(ownRecord.personalEmail).toBe("private@example.com");

    const otherEmployee = await service.createEmployee(adminCtx, baseInput({ lastName: "NotSelf" }));
    await expect(service.getEmployee(selfCtx, otherEmployee.id)).rejects.toBeInstanceOf(AuthorizationError);

    // managerCtx has employee.view but not employee.view_private
    const redacted = await service.getEmployee(managerCtx, employee.id);
    expect(redacted.personalEmail).toBeNull();
    expect(redacted.firstName).toBe("Test");

    await db.delete(schema.users).where(eq(schema.users.id, selfUser!.id));
  });

  it("clamps pageSize server-side even if a large value is requested", async () => {
    const result = await service.listEmployees(adminCtx, { page: 1, pageSize: 99999 });
    expect(result.pageSize).toBeLessThanOrEqual(100);
  });

  it("filters employees by department and search term", async () => {
    const unique = `Findme${Date.now()}`;
    await service.createEmployee(adminCtx, baseInput({ lastName: unique }));

    const bySearch = await service.listEmployees(adminCtx, { page: 1, pageSize: 25, search: unique });
    expect(bySearch.items.some((e) => e.lastName === unique)).toBe(true);

    const byDepartment = await service.listEmployees(adminCtx, { page: 1, pageSize: 25, departmentId });
    expect(byDepartment.items.every((e) => e.departmentId === departmentId)).toBe(true);
  });

  it("returns one org chart level at a time with correct direct-report counts", async () => {
    const manager = await service.createEmployee(adminCtx, baseInput({ lastName: "OrgRoot" }));
    const reportA = await service.createEmployee(adminCtx, baseInput({ lastName: "OrgReportA", managerId: manager.id }));
    await service.createEmployee(adminCtx, baseInput({ lastName: "OrgReportB", managerId: manager.id }));
    await service.createEmployee(adminCtx, baseInput({ lastName: "OrgGrandchild", managerId: reportA.id }));

    const topLevel = await service.getOrgChartSubtree(adminCtx, null);
    const managerNode = topLevel.find((n) => n.id === manager.id);
    expect(managerNode?.directReportCount).toBe(2);

    const managerLevel = await service.getOrgChartSubtree(adminCtx, manager.id);
    expect(managerLevel).toHaveLength(2);
    const reportANode = managerLevel.find((n) => n.id === reportA.id);
    expect(reportANode?.directReportCount).toBe(1);
  });
});
