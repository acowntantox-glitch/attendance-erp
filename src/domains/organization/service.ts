import type { RequestContext } from "@/lib/auth/request-context";
import { assertCompanyAccess, requirePermission } from "@/lib/auth/request-context";
import { isUniqueViolation } from "@/lib/errors";
import { recordAuditLog } from "@/domains/audit/service";
import { branchRepository, companyRepository, departmentRepository, locationRepository } from "./repository";
import {
  BranchNotFoundError,
  CompanyNotFoundError,
  DepartmentNotFoundError,
  DuplicateCodeError,
  LocationNotFoundError,
} from "./errors";
import type {
  Branch,
  Company,
  CreateBranchInput,
  CreateDepartmentInput,
  CreateLocationInput,
  Department,
  Location,
} from "./model";

export async function getMyCompany(ctx: RequestContext): Promise<Company> {
  requirePermission(ctx, "organization.read");
  const company = await companyRepository.findById(ctx.companyId);
  if (!company) throw new CompanyNotFoundError();
  return company;
}

export async function listBranches(ctx: RequestContext): Promise<Branch[]> {
  requirePermission(ctx, "organization.read");
  return branchRepository.listByCompany(ctx.companyId);
}

export async function getBranch(ctx: RequestContext, branchId: string): Promise<Branch> {
  requirePermission(ctx, "organization.read");
  const branch = await branchRepository.findById(branchId);
  if (!branch) throw new BranchNotFoundError();
  assertCompanyAccess(ctx, branch.companyId);
  return branch;
}

export async function createBranch(ctx: RequestContext, input: CreateBranchInput): Promise<Branch> {
  requirePermission(ctx, "organization.manage");
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

export async function listDepartments(ctx: RequestContext): Promise<Department[]> {
  requirePermission(ctx, "organization.read");
  return departmentRepository.listByCompany(ctx.companyId);
}

export async function getDepartment(ctx: RequestContext, departmentId: string): Promise<Department> {
  requirePermission(ctx, "organization.read");
  const department = await departmentRepository.findById(departmentId);
  if (!department) throw new DepartmentNotFoundError();
  assertCompanyAccess(ctx, department.companyId);
  return department;
}

export async function createDepartment(ctx: RequestContext, input: CreateDepartmentInput): Promise<Department> {
  requirePermission(ctx, "organization.manage");
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
