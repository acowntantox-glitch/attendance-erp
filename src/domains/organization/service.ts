import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { isUniqueViolation } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
// Narrow, repository-level cross-domain read (not a service-to-service call) used only for
// archive-safety checks ("does this org-structure entity still have active employees?") — see
// Phase 2 plan decision 7. Employee is downstream of Organization, so this doesn't invert the
// documented dependency direction at the business-logic layer.
import { employeeRepository } from "@/domains/employee/repository";
import {
  branchRepository,
  companyRepository,
  departmentRepository,
  designationRepository,
  locationRepository,
} from "./repository";
import {
  BranchHasActiveEmployeesError,
  BranchNotFoundError,
  CircularDepartmentHierarchyError,
  CompanyNotFoundError,
  DepartmentHasActiveEmployeesError,
  DepartmentNotFoundError,
  DesignationHasActiveEmployeesError,
  DesignationNotFoundError,
  DuplicateCodeError,
  LocationNotFoundError,
} from "./errors";
import type {
  Branch,
  Company,
  CreateBranchInput,
  CreateDepartmentInput,
  CreateDesignationInput,
  CreateLocationInput,
  Department,
  Designation,
  Location,
  UpdateBranchInput,
  UpdateDepartmentInput,
  UpdateDesignationInput,
} from "./model";

export async function getMyCompany(ctx: RequestContext): Promise<Company> {
  requirePermission(ctx, "organization.read");
  const company = await companyRepository.findById(ctx.companyId);
  if (!company) throw new CompanyNotFoundError();
  return company;
}

export async function listBranches(ctx: RequestContext): Promise<Branch[]> {
  requirePermission(ctx, "location.view");
  return branchRepository.listByCompany(ctx.companyId);
}

export async function getBranch(ctx: RequestContext, branchId: string): Promise<Branch> {
  requirePermission(ctx, "location.view");
  const branch = await branchRepository.findById(branchId);
  if (!branch) throw new BranchNotFoundError();
  assertCompanyAccess(ctx, branch.companyId);
  return branch;
}

export async function createBranch(ctx: RequestContext, input: CreateBranchInput): Promise<Branch> {
  requirePermission(ctx, "location.create");
  try {
    const branch = await branchRepository.create(ctx.companyId, input);
    await recordAuditLog(ctx, {
      action: "branch.create",
      entityType: "branch",
      entityId: branch.id,
      newData: branch,
    });
    return branch;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCodeError("branch", input.code);
    throw error;
  }
}

export async function updateBranch(ctx: RequestContext, branchId: string, input: UpdateBranchInput): Promise<Branch> {
  requirePermission(ctx, "location.update");
  const existing = await branchRepository.findById(branchId);
  if (!existing) throw new BranchNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  const branch = await branchRepository.update(branchId, input);
  await recordAuditLog(ctx, {
    action: "branch.update",
    entityType: "branch",
    entityId: branch.id,
    oldData: existing,
    newData: branch,
  });
  return branch;
}

export async function setBranchActive(ctx: RequestContext, branchId: string, isActive: boolean): Promise<Branch> {
  requirePermission(ctx, "location.archive");
  const existing = await branchRepository.findById(branchId);
  if (!existing) throw new BranchNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (!isActive && (await employeeRepository.existsActiveAtLocation(branchId))) {
    throw new BranchHasActiveEmployeesError();
  }

  const branch = await branchRepository.setActive(branchId, isActive);
  await recordAuditLog(ctx, {
    action: isActive ? "branch.restore" : "branch.archive",
    entityType: "branch",
    entityId: branch.id,
    oldData: existing,
    newData: branch,
  });
  return branch;
}

export async function listDepartments(ctx: RequestContext): Promise<Department[]> {
  requirePermission(ctx, "department.view");
  return departmentRepository.listByCompany(ctx.companyId);
}

export async function getDepartment(ctx: RequestContext, departmentId: string): Promise<Department> {
  requirePermission(ctx, "department.view");
  const department = await departmentRepository.findById(departmentId);
  if (!department) throw new DepartmentNotFoundError();
  assertCompanyAccess(ctx, department.companyId);
  return department;
}

/**
 * Walks the proposed parent's ancestor chain; throws if `departmentId` appears in it (which
 * would mean departmentId is already an ancestor of newParentId, so making newParentId the
 * parent of departmentId would close a cycle), or if newParentId is departmentId itself.
 */
async function assertNoCircularDepartmentHierarchy(departmentId: string, newParentId: string): Promise<void> {
  if (newParentId === departmentId) throw new CircularDepartmentHierarchyError();

  const visited = new Set<string>();
  let current = await departmentRepository.findById(newParentId);
  while (current?.parentDepartmentId) {
    if (current.parentDepartmentId === departmentId) throw new CircularDepartmentHierarchyError();
    if (visited.has(current.id)) break; // guards against pre-existing bad data forming a loop
    visited.add(current.id);
    current = await departmentRepository.findById(current.parentDepartmentId);
  }
}

export async function createDepartment(ctx: RequestContext, input: CreateDepartmentInput): Promise<Department> {
  requirePermission(ctx, "department.create");

  if (input.parentDepartmentId) {
    const parent = await departmentRepository.findById(input.parentDepartmentId);
    if (!parent) throw new DepartmentNotFoundError();
    assertCompanyAccess(ctx, parent.companyId);
  }

  try {
    const department = await departmentRepository.create(ctx.companyId, input);
    await recordAuditLog(ctx, {
      action: "department.create",
      entityType: "department",
      entityId: department.id,
      newData: department,
    });
    return department;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCodeError("department", input.code);
    throw error;
  }
}

export async function updateDepartment(
  ctx: RequestContext,
  departmentId: string,
  input: UpdateDepartmentInput,
): Promise<Department> {
  requirePermission(ctx, "department.update");
  const existing = await departmentRepository.findById(departmentId);
  if (!existing) throw new DepartmentNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (input.parentDepartmentId) {
    const parent = await departmentRepository.findById(input.parentDepartmentId);
    if (!parent) throw new DepartmentNotFoundError();
    assertCompanyAccess(ctx, parent.companyId);
    await assertNoCircularDepartmentHierarchy(departmentId, input.parentDepartmentId);
  }

  const department = await departmentRepository.update(departmentId, input);
  await recordAuditLog(ctx, {
    action: "department.update",
    entityType: "department",
    entityId: department.id,
    oldData: existing,
    newData: department,
  });
  return department;
}

export async function setDepartmentActive(
  ctx: RequestContext,
  departmentId: string,
  isActive: boolean,
): Promise<Department> {
  requirePermission(ctx, "department.archive");
  const existing = await departmentRepository.findById(departmentId);
  if (!existing) throw new DepartmentNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (!isActive && (await employeeRepository.existsActiveInDepartment(departmentId))) {
    throw new DepartmentHasActiveEmployeesError();
  }

  const department = await departmentRepository.setActive(departmentId, isActive);
  await recordAuditLog(ctx, {
    action: isActive ? "department.restore" : "department.archive",
    entityType: "department",
    entityId: department.id,
    oldData: existing,
    newData: department,
  });
  return department;
}

export async function listDesignations(ctx: RequestContext): Promise<Designation[]> {
  requirePermission(ctx, "designation.view");
  return designationRepository.listByCompany(ctx.companyId);
}

export async function getDesignation(ctx: RequestContext, designationId: string): Promise<Designation> {
  requirePermission(ctx, "designation.view");
  const designation = await designationRepository.findById(designationId);
  if (!designation) throw new DesignationNotFoundError();
  assertCompanyAccess(ctx, designation.companyId);
  return designation;
}

export async function createDesignation(ctx: RequestContext, input: CreateDesignationInput): Promise<Designation> {
  requirePermission(ctx, "designation.create");
  try {
    const designation = await designationRepository.create(ctx.companyId, input);
    await recordAuditLog(ctx, {
      action: "designation.create",
      entityType: "designation",
      entityId: designation.id,
      newData: designation,
    });
    return designation;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateCodeError("designation", input.code);
    throw error;
  }
}

export async function updateDesignation(
  ctx: RequestContext,
  designationId: string,
  input: UpdateDesignationInput,
): Promise<Designation> {
  requirePermission(ctx, "designation.update");
  const existing = await designationRepository.findById(designationId);
  if (!existing) throw new DesignationNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  const designation = await designationRepository.update(designationId, input);
  await recordAuditLog(ctx, {
    action: "designation.update",
    entityType: "designation",
    entityId: designation.id,
    oldData: existing,
    newData: designation,
  });
  return designation;
}

export async function setDesignationActive(
  ctx: RequestContext,
  designationId: string,
  isActive: boolean,
): Promise<Designation> {
  requirePermission(ctx, "designation.archive");
  const existing = await designationRepository.findById(designationId);
  if (!existing) throw new DesignationNotFoundError();
  assertCompanyAccess(ctx, existing.companyId);

  if (!isActive && (await employeeRepository.existsActiveInDesignation(designationId))) {
    throw new DesignationHasActiveEmployeesError();
  }

  const designation = await designationRepository.setActive(designationId, isActive);
  await recordAuditLog(ctx, {
    action: isActive ? "designation.restore" : "designation.archive",
    entityType: "designation",
    entityId: designation.id,
    oldData: existing,
    newData: designation,
  });
  return designation;
}

export async function listLocations(ctx: RequestContext): Promise<Location[]> {
  requirePermission(ctx, "organization.read");
  return locationRepository.listByCompany(ctx.companyId);
}

export async function getLocation(ctx: RequestContext, locationId: string): Promise<Location> {
  requirePermission(ctx, "organization.read");
  const location = await locationRepository.findById(locationId);
  if (!location) throw new LocationNotFoundError();
  assertCompanyAccess(ctx, location.companyId);
  return location;
}

export async function createLocation(ctx: RequestContext, input: CreateLocationInput): Promise<Location> {
  requirePermission(ctx, "organization.manage");
  const branch = await branchRepository.findById(input.branchId);
  if (!branch) throw new BranchNotFoundError();
  assertCompanyAccess(ctx, branch.companyId);

  const location = await locationRepository.create(ctx.companyId, input);
  await recordAuditLog(ctx, {
    action: "location.create",
    entityType: "location",
    entityId: location.id,
    newData: location,
  });
  return location;
}
