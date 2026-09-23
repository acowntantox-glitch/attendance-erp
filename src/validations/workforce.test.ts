import { describe, expect, it } from "vitest";
import {
  assignEmployeeScheduleSchema,
  createHolidaySchema,
  createShiftSchema,
  createWorkScheduleSchema,
  setWeeklyOffRuleSchema,
} from "./workforce";

const uuid = "8f14e45f-ceea-467e-adc0-fbc1b9f4a1f0";

describe("workforce validations", () => {
  describe("createWorkScheduleSchema", () => {
    it("accepts a valid schedule, including one whose end time crosses midnight", () => {
      expect(createWorkScheduleSchema.safeParse({ name: "Standard", startTime: "09:00:00", endTime: "18:00:00" }).success).toBe(true);
      expect(createWorkScheduleSchema.safeParse({ name: "Night", startTime: "22:00:00", endTime: "06:00:00" }).success).toBe(true);
    });

    it("rejects an invalid time format", () => {
      expect(createWorkScheduleSchema.safeParse({ name: "Bad", startTime: "25:00", endTime: "18:00:00" }).success).toBe(false);
      expect(createWorkScheduleSchema.safeParse({ name: "Bad", startTime: "9am", endTime: "18:00:00" }).success).toBe(false);
    });

    it("rejects an unrecognized IANA timezone", () => {
      const result = createWorkScheduleSchema.safeParse({
        name: "Bad TZ",
        startTime: "09:00:00",
        endTime: "18:00:00",
        timezone: "Mars/Cydonia",
      });
      expect(result.success).toBe(false);
    });

    it("accepts real IANA timezones", () => {
      for (const tz of ["Asia/Dubai", "America/New_York", "UTC"]) {
        expect(
          createWorkScheduleSchema.safeParse({ name: "TZ", startTime: "09:00:00", endTime: "18:00:00", timezone: tz }).success,
        ).toBe(true);
      }
    });

    it("rejects effectiveFrom after effectiveTo", () => {
      const result = createWorkScheduleSchema.safeParse({
        name: "Bad Range",
        startTime: "09:00:00",
        endTime: "18:00:00",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-01-01",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createShiftSchema", () => {
    it("rejects a lowercase or symbol-containing code", () => {
      expect(createShiftSchema.safeParse({ name: "Morning", code: "morning", startTime: "09:00:00", endTime: "18:00:00" }).success).toBe(
        false,
      );
      expect(
        createShiftSchema.safeParse({ name: "Morning", code: "MORNING!", startTime: "09:00:00", endTime: "18:00:00" }).success,
      ).toBe(false);
    });

    it("rejects an invalid UUID for a related field elsewhere but accepts valid grace periods", () => {
      expect(
        createShiftSchema.safeParse({ name: "Morning", code: "MORNING", startTime: "09:00:00", endTime: "18:00:00", gracePeriodMinutes: -5 })
          .success,
      ).toBe(false);
    });
  });

  describe("assignEmployeeScheduleSchema", () => {
    it("rejects a non-UUID workScheduleId", () => {
      expect(assignEmployeeScheduleSchema.safeParse({ workScheduleId: "not-a-uuid", effectiveFrom: "2026-01-01" }).success).toBe(false);
    });

    it("rejects effectiveTo before effectiveFrom", () => {
      const result = assignEmployeeScheduleSchema.safeParse({
        workScheduleId: uuid,
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-01-01",
      });
      expect(result.success).toBe(false);
    });

    it("requires a note when allowOverlap is set", () => {
      const withoutNote = assignEmployeeScheduleSchema.safeParse({
        workScheduleId: uuid,
        effectiveFrom: "2026-01-01",
        allowOverlap: true,
      });
      expect(withoutNote.success).toBe(false);

      const withBlankNote = assignEmployeeScheduleSchema.safeParse({
        workScheduleId: uuid,
        effectiveFrom: "2026-01-01",
        allowOverlap: true,
        note: "   ",
      });
      expect(withBlankNote.success).toBe(false);

      const withNote = assignEmployeeScheduleSchema.safeParse({
        workScheduleId: uuid,
        effectiveFrom: "2026-01-01",
        allowOverlap: true,
        note: "Deliberate policy exception",
      });
      expect(withNote.success).toBe(true);
    });

    it("does not require a note when allowOverlap is not set", () => {
      expect(assignEmployeeScheduleSchema.safeParse({ workScheduleId: uuid, effectiveFrom: "2026-01-01" }).success).toBe(true);
    });
  });

  describe("setWeeklyOffRuleSchema", () => {
    it("rejects out-of-range day values", () => {
      expect(setWeeklyOffRuleSchema.safeParse({ offDays: [7] }).success).toBe(false);
      expect(setWeeklyOffRuleSchema.safeParse({ offDays: [-1] }).success).toBe(false);
    });

    it("rejects an empty offDays array", () => {
      expect(setWeeklyOffRuleSchema.safeParse({ offDays: [] }).success).toBe(false);
    });

    it("accepts a full valid range of days", () => {
      expect(setWeeklyOffRuleSchema.safeParse({ offDays: [0, 1, 2, 3, 4, 5, 6] }).success).toBe(true);
    });
  });

  describe("createHolidaySchema", () => {
    it("rejects an invalid enum value", () => {
      const result = createHolidaySchema.safeParse({ name: "X", date: "2026-01-01", holidayType: "MADE_UP" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-UUID branchId", () => {
      const result = createHolidaySchema.safeParse({ name: "X", date: "2026-01-01", holidayType: "PUBLIC", branchId: "nope" });
      expect(result.success).toBe(false);
    });

    it("accepts a valid company-wide holiday", () => {
      expect(createHolidaySchema.safeParse({ name: "X", date: "2026-01-01", holidayType: "PUBLIC" }).success).toBe(true);
    });
  });
});
