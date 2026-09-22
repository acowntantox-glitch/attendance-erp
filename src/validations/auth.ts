import { z } from "zod";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
  companyId: z.uuid().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
