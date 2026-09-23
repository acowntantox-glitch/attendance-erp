import "./load-env";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import {
  branches,
  companies,
  companyMemberships,
  departments,
  designations,
  employeeDocuments,
  locations,
  users,
} from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { createEmployee } from "../src/domains/employee/service";
import {
  assignEmployeeSchedule,
  createHoliday,
  createShift,
  createWorkSchedule,
  setCompanyDefaultWeeklyOff,
} from "../src/domains/workforce/service";
import type { RequestContext } from "../src/lib/auth/request-context";

const DEV_PASSWORD = "DevPassword123!";

function daysFromNowIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  const [hqBranch] = await db
    .insert(branches)
    .values({
      companyId: company.id,
      name: "Head Office",
      code: "HQ",
      address: "Sheikh Zayed Road",
      city: "Dubai",
      state: "Dubai",
      country: "AE",
      postalCode: "00000",
    })
    .returning();
  if (!hqBranch) throw new Error("Failed to seed branch");

  await db.insert(branches).values({
    companyId: company.id,
    name: "Remote",
    code: "REMOTE",
    country: "AE",
  });

  const [hrDept] = await db
    .insert(departments)
    .values({ companyId: company.id, name: "Human Resources", code: "HR" })
    .returning();
  const [engDept] = await db
    .insert(departments)
    .values({ companyId: company.id, name: "Engineering", code: "ENG" })
    .returning();
  if (!hrDept || !engDept) throw new Error("Failed to seed departments");

  const [platformDept] = await db
    .insert(departments)
    .values({
      companyId: company.id,
      name: "Platform Engineering",
      code: "ENG-PLAT",
      parentDepartmentId: engDept.id,
    })
    .returning();
  if (!platformDept) throw new Error("Failed to seed child department");

  const [swEngDesig] = await db
    .insert(designations)
    .values({ companyId: company.id, name: "Software Engineer", code: "ENG-SWE", level: 2 })
    .returning();
  const [engMgrDesig] = await db
    .insert(designations)
    .values({ companyId: company.id, name: "Engineering Manager", code: "ENG-MGR", level: 4 })
    .returning();
  const [hrGenDesig] = await db
    .insert(designations)
    .values({ companyId: company.id, name: "HR Generalist", code: "HR-GEN", level: 2 })
    .returning();
  const [hrDirDesig] = await db
    .insert(designations)
    .values({ companyId: company.id, name: "HR Director", code: "HR-DIR", level: 5 })
    .returning();
  const [officeAdminDesig] = await db
    .insert(designations)
    .values({ companyId: company.id, name: "Office Administrator", code: "ADM-OFC", level: 1 })
    .returning();
  if (!swEngDesig || !engMgrDesig || !hrGenDesig || !hrDirDesig || !officeAdminDesig) {
    throw new Error("Failed to seed designations");
  }

  await db.insert(locations).values([
    {
      companyId: company.id,
      branchId: hqBranch.id,
      name: "HQ Main Entrance",
      address: "Dubai, UAE",
      latitude: "25.204849",
      longitude: "55.270782",
      timezone: "Asia/Dubai",
    },
    {
      companyId: company.id,
      branchId: hqBranch.id,
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

  const userIdByEmail = new Map<string, string>();
  for (const seedUser of seedUsers) {
    const [user] = await db
      .insert(users)
      .values({ email: seedUser.email, passwordHash, fullName: seedUser.fullName })
      .returning();
    if (!user) throw new Error(`Failed to seed user ${seedUser.email}`);
    userIdByEmail.set(seedUser.email, user.id);

    await db.insert(companyMemberships).values({
      userId: user.id,
      companyId: company.id,
      role: seedUser.role,
    });
    console.log(`  Seeded ${seedUser.role.padEnd(14)} ${seedUser.email}`);
  }

  // Employee records are created through the real service (not raw inserts) so seeding
  // exercises the same employee-number counter / structured-history / validation logic
  // production traffic does — the one deliberate exception to this file's usual
  // raw-insert-for-bootstrap-data style (company/branch/department/designation above).
  const adminUserId = userIdByEmail.get("admin@acme.dev")!;
  const ctx: RequestContext = {
    requestId: "seed",
    userId: adminUserId,
    userEmail: "admin@acme.dev",
    companyId: company.id,
    role: "COMPANY_ADMIN",
    employeeId: null,
  };

  const adam = await createEmployee(ctx, {
    firstName: "Adam",
    lastName: "Admin",
    workEmail: "admin@acme.dev",
    dateOfJoining: "2024-01-01",
    locationId: hqBranch.id,
    userId: adminUserId,
  });

  const hana = await createEmployee(ctx, {
    firstName: "Hana",
    lastName: "HR Admin",
    workEmail: "hradmin@acme.dev",
    dateOfJoining: "2024-02-01",
    departmentId: hrDept.id,
    designationId: hrDirDesig.id,
    locationId: hqBranch.id,
    managerId: adam.id,
    userId: userIdByEmail.get("hradmin@acme.dev"),
  });

  const hassan = await createEmployee(ctx, {
    firstName: "Hassan",
    lastName: "HR Manager",
    workEmail: "hrmanager@acme.dev",
    dateOfJoining: "2024-03-01",
    departmentId: hrDept.id,
    designationId: hrGenDesig.id,
    locationId: hqBranch.id,
    managerId: hana.id,
    userId: userIdByEmail.get("hrmanager@acme.dev"),
  });

  const mona = await createEmployee(ctx, {
    firstName: "Mona",
    lastName: "Manager",
    workEmail: "manager@acme.dev",
    dateOfJoining: "2024-04-01",
    departmentId: engDept.id,
    designationId: engMgrDesig.id,
    locationId: hqBranch.id,
    managerId: adam.id,
    userId: userIdByEmail.get("manager@acme.dev"),
  });

  // Head of Engineering — set directly (no service-layer department-head assignment flow exists
  // yet, matching the raw-insert style used for other pure bootstrap data in this script).
  await db.update(departments).set({ departmentHeadId: mona.id }).where(eq(departments.id, engDept.id));

  const eve = await createEmployee(ctx, {
    firstName: "Eve",
    lastName: "Employee",
    workEmail: "employee@acme.dev",
    dateOfJoining: "2025-01-15",
    departmentId: platformDept.id,
    designationId: swEngDesig.id,
    locationId: hqBranch.id,
    managerId: mona.id,
    userId: userIdByEmail.get("employee@acme.dev"),
  });

  await createEmployee(ctx, {
    firstName: "Priya",
    lastName: "Patel",
    workEmail: "priya.patel@acme.dev",
    dateOfJoining: "2025-03-01",
    departmentId: platformDept.id,
    designationId: swEngDesig.id,
    locationId: hqBranch.id,
    managerId: mona.id,
  });

  await createEmployee(ctx, {
    firstName: "Jordan",
    lastName: "Lee",
    workEmail: "jordan.lee@acme.dev",
    dateOfJoining: "2025-05-01",
    departmentId: engDept.id,
    designationId: swEngDesig.id,
    locationId: hqBranch.id,
    managerId: mona.id,
  });

  await createEmployee(ctx, {
    firstName: "Sam",
    lastName: "Wilson",
    workEmail: "sam.wilson@acme.dev",
    dateOfJoining: "2025-02-01",
    departmentId: hrDept.id,
    designationId: officeAdminDesig.id,
    locationId: hqBranch.id,
    managerId: hassan.id,
  });

  console.log("  Seeded 8 employee records with a 3-level manager hierarchy");

  // Sample documents so the expiry-status UI has something to show without manual setup.
  await db.insert(employeeDocuments).values([
    {
      companyId: company.id,
      employeeId: eve.id,
      documentType: "VISA",
      title: "UAE Residence Visa",
      storageKey: "seed/placeholder-not-a-real-object",
      originalFilename: "visa.pdf",
      mimeType: "application/pdf",
      sizeBytes: 102400,
      issueDate: daysFromNowIso(-300),
      expiryDate: daysFromNowIso(15), // expiring soon
      uploadedByUserId: adminUserId,
    },
    {
      companyId: company.id,
      employeeId: eve.id,
      documentType: "PASSPORT",
      title: "Passport",
      storageKey: "seed/placeholder-not-a-real-object-2",
      originalFilename: "passport.pdf",
      mimeType: "application/pdf",
      sizeBytes: 98304,
      issueDate: daysFromNowIso(-2000),
      expiryDate: daysFromNowIso(-10), // already expired
      uploadedByUserId: adminUserId,
    },
  ]);
  console.log("  Seeded 2 sample documents for Eve Employee (one expiring soon, one expired)");
  console.log(
    "  NOTE: seeded document storage_key values are placeholders with no real S3 object behind them — downloading them will fail until real storage is configured and real files are uploaded through the UI.",
  );

  // Workforce Management sample data — seeded through the real service (same rationale as
  // employee records above), so the schedule/shift validation and history logic is exercised
  // during seeding too, not just at runtime.
  //
  // UAE weekends are Friday+Saturday (5, 6) — this is seed data for the demo company, not a
  // hard-coded assumption anywhere in the workforce domain itself.
  await setCompanyDefaultWeeklyOff(ctx, { offDays: [5, 6] });

  const standardWeek = await createWorkSchedule(ctx, {
    name: "Standard Week",
    description: "09:00-18:00 with a 1 hour unpaid lunch break",
    startTime: "09:00:00",
    endTime: "18:00:00",
    breakDurationMinutes: 60,
    breakStartTime: "13:00:00",
    isBreakPaid: false,
  });

  const morningShift = await createShift(ctx, {
    name: "Morning",
    code: "MORNING",
    startTime: "09:00:00",
    endTime: "18:00:00",
    breakDurationMinutes: 60,
    breakStartTime: "13:00:00",
    gracePeriodMinutes: 10,
  });

  // Deliberately crosses midnight (end < start) — exercises the same cross-midnight handling
  // Attendance will rely on later (docs/architecture/attendance-architecture.md).
  const nightShift = await createShift(ctx, {
    name: "Night",
    code: "NIGHT",
    startTime: "22:00:00",
    endTime: "06:00:00",
    breakDurationMinutes: 30,
    breakStartTime: "02:00:00",
    gracePeriodMinutes: 10,
  });

  await assignEmployeeSchedule(ctx, eve.id, {
    workScheduleId: standardWeek.id,
    shiftId: morningShift.id,
    effectiveFrom: eve.dateOfJoining,
  });
  await assignEmployeeSchedule(ctx, mona.id, { workScheduleId: standardWeek.id, effectiveFrom: mona.dateOfJoining });
  await assignEmployeeSchedule(ctx, hassan.id, { workScheduleId: standardWeek.id, effectiveFrom: hassan.dateOfJoining });
  // One employee on the explicit Night shift override, so the cross-midnight path has real data
  // behind it rather than only existing in tests.
  await assignEmployeeSchedule(ctx, hana.id, {
    workScheduleId: standardWeek.id,
    shiftId: nightShift.id,
    effectiveFrom: hana.dateOfJoining,
  });

  console.log("  Seeded 1 work schedule, 2 shifts (incl. a cross-midnight Night shift), and 4 employee schedule assignments");

  const currentYear = new Date().getUTCFullYear();
  await createHoliday(ctx, {
    name: "New Year's Day",
    date: `${currentYear + 1}-01-01`,
    holidayType: "PUBLIC",
    description: "Company-wide public holiday.",
  });
  await createHoliday(ctx, {
    name: "UAE National Day",
    date: `${currentYear}-12-02`,
    holidayType: "PUBLIC",
    description: "Company-wide public holiday.",
  });
  await createHoliday(ctx, {
    branchId: hqBranch.id,
    name: "Head Office Maintenance Day",
    date: `${currentYear}-11-15`,
    holidayType: "COMPANY",
    description: "Branch-scoped holiday — Head Office only, demonstrates the branch-scoped holiday path.",
  });
  console.log("  Seeded 3 holidays (2 company-wide, 1 branch-scoped)");

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
