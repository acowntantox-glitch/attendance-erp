import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companyMemberships, users } from "@/db/schema";
import type { User } from "./model";

export const userRepository = {
  findByEmail(email: string) {
    return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  },
  findById(id: string) {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  },
  create(input: Pick<User, "email" | "passwordHash" | "fullName">) {
    return db
      .insert(users)
      .values({ ...input, email: input.email.toLowerCase() })
      .returning()
      .then((rows) => rows[0]!);
  },
};

export const companyMembershipRepository = {
  listActiveForUser(userId: string) {
    return db.query.companyMemberships.findMany({
      where: and(eq(companyMemberships.userId, userId), eq(companyMemberships.isActive, true)),
      with: { company: true },
    });
  },
  findForUserAndCompany(userId: string, companyId: string) {
    return db.query.companyMemberships.findFirst({
      where: and(
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.isActive, true),
      ),
    });
  },
  create(input: { userId: string; companyId: string; role: (typeof companyMemberships.$inferInsert)["role"] }) {
    return db
      .insert(companyMemberships)
      .values(input)
      .returning()
      .then((rows) => rows[0]!);
  },
};
