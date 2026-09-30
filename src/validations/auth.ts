import { z } from "zod";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
  companyId: z.uuid().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Bounded so an oversized body cannot be used to burn Argon2 CPU; the real password policy
 *  (length window, blocklist) is applied by the service through `validatePasswordPolicy`. */
const passwordField = z.string().max(128, "Password is too long.");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required.").max(128),
    newPassword: passwordField.min(1, "New password is required."),
    confirmPassword: passwordField,
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "New password and confirmation do not match.",
  });

export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const setUserStatusSchema = z.object({ active: z.boolean() });

export const userIdParamSchema = z.uuid();
