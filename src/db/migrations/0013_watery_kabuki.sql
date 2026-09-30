ALTER TYPE "public"."attendance_daily_status" ADD VALUE 'UNDER_HOURS';--> statement-breakpoint
CREATE TABLE "attendance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"default_grace_period_minutes" integer DEFAULT 0 NOT NULL,
	"early_departure_grace_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_threshold_minutes" integer DEFAULT 0 NOT NULL,
	"minimum_worked_minutes" integer,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_policies_default_grace_nonneg" CHECK ("attendance_policies"."default_grace_period_minutes" >= 0),
	CONSTRAINT "attendance_policies_early_grace_nonneg" CHECK ("attendance_policies"."early_departure_grace_minutes" >= 0),
	CONSTRAINT "attendance_policies_overtime_threshold_nonneg" CHECK ("attendance_policies"."overtime_threshold_minutes" >= 0),
	CONSTRAINT "attendance_policies_minimum_worked_nonneg" CHECK ("attendance_policies"."minimum_worked_minutes" is null or "attendance_policies"."minimum_worked_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_policies_company_unique" ON "attendance_policies" USING btree ("company_id");