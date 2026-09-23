import { z } from "zod";

const codeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, "Code must be uppercase letters, numbers, hyphens, or underscores");

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Time must be in HH:mm or HH:mm:ss format");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
const timezoneSchema = z.string().max(64).refine(isValidTimezone, "Not a recognized IANA timezone");

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const effectiveRangeRefinement = <T extends { effectiveFrom?: string; effectiveTo?: string | null }>(data: T) =>
  !data.effectiveFrom || !data.effectiveTo || data.effectiveTo >= data.effectiveFrom;

export const createWorkScheduleSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    timezone: timezoneSchema.optional(),
    startTime: timeSchema,
    endTime: timeSchema,
    breakDurationMinutes: z.number().int().min(0).max(1440).optional(),
    breakStartTime: timeSchema.optional(),
    isBreakPaid: z.boolean().optional(),
    effectiveFrom: dateSchema.optional(),
    effectiveTo: dateSchema.optional(),
  })
  .refine(effectiveRangeRefinement, { message: "effectiveTo must be on or after effectiveFrom", path: ["effectiveTo"] });

export const updateWorkScheduleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    timezone: timezoneSchema.optional(),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    breakDurationMinutes: z.number().int().min(0).max(1440).optional(),
    breakStartTime: timeSchema.optional(),
    isBreakPaid: z.boolean().optional(),
    effectiveFrom: dateSchema.optional(),
    effectiveTo: dateSchema.optional(),
  })
  .refine(effectiveRangeRefinement, { message: "effectiveTo must be on or after effectiveFrom", path: ["effectiveTo"] });

export const createShiftSchema = z.object({
  name: z.string().min(1).max(200),
  code: codeSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  breakDurationMinutes: z.number().int().min(0).max(1440).optional(),
  breakStartTime: timeSchema.optional(),
  isBreakPaid: z.boolean().optional(),
  gracePeriodMinutes: z.number().int().min(0).max(240).optional(),
});

export const updateShiftSchema = createShiftSchema.omit({ code: true }).partial();

export const setActiveSchema = z.object({ isActive: z.boolean() });

export const assignEmployeeScheduleSchema = z
  .object({
    workScheduleId: z.uuid(),
    shiftId: z.uuid().nullable().optional(),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema.nullable().optional(),
    note: z.string().max(1000).optional(),
    allowOverlap: z.boolean().optional(),
  })
  .refine((data) => !data.effectiveTo || data.effectiveTo >= data.effectiveFrom, {
    message: "effectiveTo must be on or after effectiveFrom",
    path: ["effectiveTo"],
  })
  .refine((data) => !data.allowOverlap || Boolean(data.note?.trim()), {
    message: "A note explaining why is required when allowOverlap is set",
    path: ["note"],
  });

export const updateEmployeeScheduleAssignmentSchema = z.object({
  effectiveTo: dateSchema.nullable().optional(),
  note: z.string().max(1000).optional(),
});

export const weeklyOffDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7);

export const setWeeklyOffRuleSchema = z
  .object({
    offDays: weeklyOffDaysSchema,
    effectiveFrom: dateSchema.optional(),
    effectiveTo: dateSchema.optional(),
  })
  .refine(effectiveRangeRefinement, { message: "effectiveTo must be on or after effectiveFrom", path: ["effectiveTo"] });

export const createHolidaySchema = z.object({
  branchId: z.uuid().optional(),
  name: z.string().min(1).max(200),
  date: dateSchema,
  holidayType: z.enum(["PUBLIC", "RELIGIOUS", "COMPANY", "OPTIONAL"]),
  description: z.string().max(1000).optional(),
});

export const updateHolidaySchema = createHolidaySchema.omit({ date: true, branchId: true }).partial();

export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type AssignEmployeeScheduleInput = z.infer<typeof assignEmployeeScheduleSchema>;
export type UpdateEmployeeScheduleAssignmentInput = z.infer<typeof updateEmployeeScheduleAssignmentSchema>;
export type SetWeeklyOffRuleInput = z.infer<typeof setWeeklyOffRuleSchema>;
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
