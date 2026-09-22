import type { companyMemberships, users } from "@/db/schema";

export type User = typeof users.$inferSelect;
export type PublicUser = Omit<User, "passwordHash">;
export type CompanyMembership = typeof companyMemberships.$inferSelect;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
