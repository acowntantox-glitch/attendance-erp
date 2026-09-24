CREATE TYPE "public"."attendance_correction_field" AS ENUM('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END');--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "field_changed" "attendance_correction_field" NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "original_value" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "corrected_value" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_event_id_attendance_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attendance_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_conflict_idx" ON "attendance_corrections" USING btree ("employee_id","work_date","field_changed");