DROP INDEX "attendance_policies_company_unique";--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD COLUMN "effective_from" date DEFAULT '1970-01-01' NOT NULL;--> statement-breakpoint
-- F-06 backfill: an existing company policy has been in force since the day it was first saved, and the
-- built-in defaults before that. (Earlier edits of its values are not recorded, so the current values apply
-- from the creation date onward - exactly what a recalculation used before this change.) Existing daily
-- records are NOT touched.
UPDATE "attendance_policies" SET "effective_from" = ("created_at" AT TIME ZONE 'UTC')::date;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_policies_company_effective_from_unique" ON "attendance_policies" USING btree ("company_id","effective_from");