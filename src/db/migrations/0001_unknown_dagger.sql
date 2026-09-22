CREATE TABLE "designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"level" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "designations_company_code_unique" UNIQUE("company_id","code")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "parent_department_id" uuid;--> statement-breakpoint
ALTER TABLE "designations" ADD CONSTRAINT "designations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_department_id_fk" FOREIGN KEY ("parent_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_parent_department_id_idx" ON "departments" USING btree ("parent_department_id");