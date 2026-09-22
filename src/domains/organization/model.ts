import type { branches, companies, departments, locations } from "@/db/schema";

export type Company = typeof companies.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Location = typeof locations.$inferSelect;

export type CreateBranchInput = {
  name: string;
  code: string;
  address?: string;
  timezone?: string;
};

export type CreateDepartmentInput = {
  name: string;
  code: string;
  description?: string;
};

export type CreateLocationInput = {
  branchId: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};
