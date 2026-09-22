import { z } from "zod";

const codeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, "Code must be uppercase letters, numbers, hyphens, or underscores");

export const createBranchSchema = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  address: z.string().max(500).optional(),
  timezone: z.string().max(64).optional(),
});

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  description: z.string().max(1000).optional(),
});

export const createLocationSchema = z.object({
  branchId: z.uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().max(64).optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
