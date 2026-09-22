import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, companies, departments, locations } from "@/db/schema";
import type { CreateBranchInput, CreateDepartmentInput, CreateLocationInput } from "./model";

export const companyRepository = {
  findById(id: string) {
    return db.query.companies.findFirst({ where: eq(companies.id, id) });
  },
};

export const branchRepository = {
  findById(id: string) {
    return db.query.branches.findFirst({ where: eq(branches.id, id) });
  },
  listByCompany(companyId: string) {
    return db.query.branches.findMany({ where: eq(branches.companyId, companyId) });
  },
  create(companyId: string, input: CreateBranchInput) {
    return db
      .insert(branches)
      .values({ companyId, ...input })
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const departmentRepository = {
  findById(id: string) {
    return db.query.departments.findFirst({ where: eq(departments.id, id) });
  },
  listByCompany(companyId: string) {
    return db.query.departments.findMany({ where: eq(departments.companyId, companyId) });
  },
  findByCode(companyId: string, code: string) {
    return db.query.departments.findFirst({
      where: and(eq(departments.companyId, companyId), eq(departments.code, code)),
    });
  },
  create(companyId: string, input: CreateDepartmentInput) {
    return db
      .insert(departments)
      .values({ companyId, ...input })
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const locationRepository = {
  findById(id: string) {
    return db.query.locations.findFirst({ where: eq(locations.id, id) });
  },
  listByCompany(companyId: string) {
    return db.query.locations.findMany({ where: eq(locations.companyId, companyId) });
  },
  create(companyId: string, input: CreateLocationInput) {
    return db
      .insert(locations)
      .values({
        companyId,
        branchId: input.branchId,
        name: input.name,
        address: input.address,
        latitude: input.latitude.toString(),
        longitude: input.longitude.toString(),
        timezone: input.timezone,
      })
      .returning()
      .then((rows) => rows[0]!);
  },
};
