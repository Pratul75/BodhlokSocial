-- Data preparation, so the constraints below apply to an existing database without failing.
-- References that point at rows that no longer exist become NULL (the new foreign keys are ON DELETE SET NULL anyway).
UPDATE "approvals" SET "calendar_item_id" = NULL WHERE "calendar_item_id" IS NOT NULL AND "calendar_item_id" NOT IN (SELECT "id" FROM "calendar_items");--> statement-breakpoint
UPDATE "approvals" SET "source_run_id" = NULL WHERE "source_run_id" IS NOT NULL AND "source_run_id" NOT IN (SELECT "id" FROM "agent_runs");--> statement-breakpoint
UPDATE "assets" SET "job_id" = NULL WHERE "job_id" IS NOT NULL AND "job_id" NOT IN (SELECT "id" FROM "creative_jobs");--> statement-breakpoint
UPDATE "brand_kit" SET "logo_asset_id" = NULL WHERE "logo_asset_id" IS NOT NULL AND "logo_asset_id" NOT IN (SELECT "id" FROM "assets");--> statement-breakpoint
UPDATE "postiz_calls" SET "calendar_item_id" = NULL WHERE "calendar_item_id" IS NOT NULL AND "calendar_item_id" NOT IN (SELECT "id" FROM "calendar_items");--> statement-breakpoint
UPDATE "ad_changes" SET "approval_id" = NULL WHERE "approval_id" IS NOT NULL AND "approval_id" NOT IN (SELECT "id" FROM "approvals");--> statement-breakpoint
UPDATE "ad_changes" SET "run_id" = NULL WHERE "run_id" IS NOT NULL AND "run_id" NOT IN (SELECT "id" FROM "agent_runs");--> statement-breakpoint
UPDATE "experiments" SET "run_id" = NULL WHERE "run_id" IS NOT NULL AND "run_id" NOT IN (SELECT "id" FROM "agent_runs");--> statement-breakpoint
UPDATE "seo_pages" SET "run_id" = NULL WHERE "run_id" IS NOT NULL AND "run_id" NOT IN (SELECT "id" FROM "agent_runs");--> statement-breakpoint
-- Values the app already treats this way when it reads them (see apps/web/lib/auth.ts for roles).
UPDATE "users" SET "role" = 'social_manager' WHERE "role" NOT IN ('admin', 'ads_manager', 'seo_manager', 'social_manager', 'sales');--> statement-breakpoint
UPDATE "connections" SET "status" = 'error', "error" = coalesce("error", 'Status reset by migration 0008.') WHERE "status" NOT IN ('not_connected', 'connected', 'error', 'pending_review');--> statement-breakpoint
UPDATE "leads" SET "status" = 'new' WHERE "status" NOT IN ('new', 'contacted', 'qualified', 'won', 'lost');--> statement-breakpoint
UPDATE "approvals" SET "status" = 'withdrawn' WHERE "status" NOT IN ('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
UPDATE "calendar_items" SET "status" = 'drafted' WHERE "status" NOT IN ('idea', 'drafted', 'in_review', 'approved', 'scheduled', 'published', 'failed');--> statement-breakpoint
UPDATE "strategy_plans" SET "status" = 'draft' WHERE "status" NOT IN ('draft', 'approved');--> statement-breakpoint
-- One plan per month: keep the approved one, else the newest draft.
DELETE FROM "strategy_plans" p USING (
  SELECT "id", row_number() OVER (PARTITION BY "month" ORDER BY ("status" = 'approved') DESC, "created_at" DESC) AS rn FROM "strategy_plans"
) d WHERE p."id" = d."id" AND d.rn > 1;--> statement-breakpoint
CREATE TABLE "directory_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"category" text NOT NULL,
	"why" text NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'found' NOT NULL,
	"review_note" text,
	"approval_id" uuid,
	"run_id" uuid,
	"submitted_url" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_listings_status_check" CHECK ("directory_listings"."status" in ('found', 'drafted', 'in_review', 'approved', 'submitted', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_kind_check" CHECK ("reports"."kind" in ('weekly', 'monthly'))
);
--> statement-breakpoint
ALTER TABLE "ad_changes" DROP CONSTRAINT "ad_changes_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "approvals" DROP CONSTRAINT "approvals_source_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_assigned_to_users_id_fk";
--> statement-breakpoint
DROP INDEX "sessions_day_channel_uq";--> statement-breakpoint
ALTER TABLE "web_sessions_daily" ADD CONSTRAINT "web_sessions_daily_pk" PRIMARY KEY("day","channel");--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "place" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "posted_url" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "posted_by" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "community_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD COLUMN "occurred_ist" date GENERATED ALWAYS AS (((occurred_at AT TIME ZONE 'Asia/Kolkata')::date)) STORED;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "platform_lead_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "form_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "directory_listings" ADD CONSTRAINT "directory_listings_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_listings" ADD CONSTRAINT "directory_listings_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_listings_url_uq" ON "directory_listings" USING btree ("url");--> statement-breakpoint
CREATE INDEX "directory_listings_status_idx" ON "directory_listings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_kind_period_uq" ON "reports" USING btree ("kind","period_start");--> statement-breakpoint
ALTER TABLE "ad_changes" ADD CONSTRAINT "ad_changes_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD CONSTRAINT "ad_changes_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_calendar_item_id_calendar_items_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."calendar_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_creative_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."creative_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_items" ADD CONSTRAINT "community_items_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_items" ADD CONSTRAINT "community_items_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postiz_calls" ADD CONSTRAINT "postiz_calls_calendar_item_id_calendar_items_id_fk" FOREIGN KEY ("calendar_item_id") REFERENCES "public"."calendar_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD CONSTRAINT "seo_pages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_changes_created_idx" ON "ad_changes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "approvals_calendar_item_idx" ON "approvals" USING btree ("calendar_item_id");--> statement-breakpoint
CREATE INDEX "approvals_kind_status_idx" ON "approvals" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "calendar_status_scheduled_idx" ON "calendar_items" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "calendar_postiz_idx" ON "calendar_items" USING btree ("postiz_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_platform_external_uq" ON "community_items" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "community_status_found_idx" ON "community_items" USING btree ("status","found_at");--> statement-breakpoint
CREATE INDEX "conv_occurred_ist_idx" ON "conversion_events" USING btree ("occurred_ist");--> statement-breakpoint
CREATE INDEX "experiments_entity_status_idx" ON "experiments" USING btree ("entity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_source_platform_id_uq" ON "leads" USING btree ("source","platform_lead_id");--> statement-breakpoint
CREATE INDEX "leads_status_created_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "seo_audits_status_idx" ON "seo_audits" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "seo_pages_site_status_idx" ON "seo_pages" USING btree ("site_status");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_plans_month_uq" ON "strategy_plans" USING btree ("month");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_kind_check" CHECK ("approvals"."kind" in ('post', 'ad_change', 'reply', 'listing', 'blog', 'page'));--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_status_check" CHECK ("approvals"."status" in ('pending', 'approved', 'rejected', 'withdrawn'));--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_singleton_check" CHECK ("brand_kit"."id" = 1);--> statement-breakpoint
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_status_check" CHECK ("calendar_items"."status" in ('idea', 'drafted', 'in_review', 'approved', 'scheduled', 'published', 'failed'));--> statement-breakpoint
ALTER TABLE "community_items" ADD CONSTRAINT "community_items_status_check" CHECK ("community_items"."status" in ('found', 'drafted', 'in_review', 'approved', 'posted', 'skipped', 'failed'));--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check" CHECK ("connections"."status" in ('not_connected', 'connected', 'error', 'pending_review'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new', 'contacted', 'qualified', 'won', 'lost'));--> statement-breakpoint
ALTER TABLE "strategy_plans" ADD CONSTRAINT "strategy_plans_status_check" CHECK ("strategy_plans"."status" in ('draft', 'approved'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'ads_manager', 'seo_manager', 'social_manager', 'sales'));