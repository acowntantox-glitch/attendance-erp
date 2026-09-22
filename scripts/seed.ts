import "./load-env";
import { db, pool } from "../src/db/client";
import { branches, companies, companyMemberships, departments, locations, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";

const DEV_PASSWORD = "DevPassword123!";

async function main() {
  console.log("Seeding development data...");
  console.log(`All seed users share the password: ${DEV_PASSWORD} (development only — never use in production)`);

  const [company] = await db
    .insert(companies)
    .values({
      name: "Acme Demo Company",
      legalName: "Acme Demo Company LLC",
      code: "ACME",
      status: "active",
      timezone: "Asia/Dubai",
    })
    .returning();
  if (!company) throw new Error("Failed to seed company");

  const [branch] = await db
    .insert(branches)
    .values({ companyId: company.id, name: "Head Office", code: "HQ", address: "Dubai, UAE" })
    .returning();
  if (!branch) throw new Error("Failed to seed branch");

  await db.insert(departments).values([
    { companyId: company.id, name: "Human Resources", code: "HR" },
    { companyId: company.id, name: "Engineering", code: "ENG" },
  ]);

  await db.insert(locations).values([
    {
      companyId: company.id,
      branchId: branch.id,
      name: "HQ Main Entrance",
      address: "Dubai, UAE",
      latitude: "25.204849",
      longitude: "55.270782",
      timezone: "Asia/Dubai",
    },
    {
      companyId: company.id,
      branchId: branch.id,
      name: "HQ Warehouse",
      address: "Dubai, UAE",
      latitude: "25.198765",
      longitude: "55.279876",
      timezone: "Asia/Dubai",
    },
  ]);

  const passwordHash = await hashPassword(DEV_PASSWORD);

  const seedUsers = [
    { email: "superadmin@acme.dev", fullName: "Sara Superadmin", role: "SUPER_ADMIN" as const },
    { email: "admin@acme.dev", fullName: "Adam Admin", role: "COMPANY_ADMIN" as const },
    { email: "hradmin@acme.dev", fullName: "Hana HR Admin", role: "HR_ADMIN" as const },
    { email: "hrmanager@acme.dev", fullName: "Hassan HR Manager", role: "HR_MANAGER" as const },
    { email: "manager@acme.dev", fullName: "Mona Manager", role: "MANAGER" as const },
    { email: "employee@acme.dev", fullName: "Eve Employee", role: "EMPLOYEE" as const },
  ];

  for (const seedUser of seedUsers) {
    const [user] = await db
      .insert(users)
      .values({ email: seedUser.email, passwordHash, fullName: seedUser.fullName })
      .returning();
    if (!user) throw new Error(`Failed to seed user ${seedUser.email}`);

    await db.insert(companyMemberships).values({
      userId: user.id,
      companyId: company.id,
      role: seedUser.role,
    });
    console.log(`  Seeded ${seedUser.role.padEnd(14)} ${seedUser.email}`);
  }

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
