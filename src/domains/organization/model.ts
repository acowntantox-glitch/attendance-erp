import type { branches, companies, departments, designations, locations } from "@/db/schema";

export type Company = typeof companies.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Designation = typeof designations.$inferSelect;

export type CreateBranchInput = {
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
};

export type UpdateBranchInput = Partial<Omit<CreateBranchInput, "code">>;

export type CreateDepartmentInput = {
  name: string;
  code: string;
  description?: string;
  parentDepartmentId?: string;
};

export type UpdateDepartmentInput = Partial<Omit<CreateDepartmentInput, "code" | "parentDepartmentId">> & {
  /** `undefined` = leave unchanged, `null` = clear (make top-level), a uuid = reparent. */
  parentDepartmentId?: string | null;
};

export type CreateLocationInput = {
  branchId: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

export type CreateDesignationInput = {
  name: string;
  code: string;
  description?: string;
  level?: number;
};

export type UpdateDesignationInput = Partial<Omit<CreateDesignationInput, "code">>;
