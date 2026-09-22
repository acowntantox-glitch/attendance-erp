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
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  timezone: z.string().max(64).optional(),
});

export const updateBranchSchema = createBranchSchema.omit({ code: true }).partial();

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  description: z.string().max(1000).optional(),
  parentDepartmentId: z.uuid().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema
  .omit({ code: true, parentDepartmentId: true })
  .partial()
  .extend({
    // undefined = leave unchanged, null = clear (make top-level), a uuid = reparent
    parentDepartmentId: z.uuid().nullable().optional(),
  });

export const createLocationSchema = z.object({
  branchId: z.uuid(),
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().max(64).optional(),
});

export const createDesignationSchema = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  description: z.string().max(1000).optional(),
  level: z.number().int().min(0).max(100).optional(),
});

export const updateDesignationSchema = createDesignationSchema.omit({ code: true }).partial();

export const setActiveSchema = z.object({
  isActive: z.boolean(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
