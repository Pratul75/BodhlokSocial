CREATE TABLE "ad_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"level" text NOT NULL,
	"platform_id" text NOT NULL,
	"parent_id" text,
	"campaign_id" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"objective" text,
	"daily_budget" numeric(12, 2),
	"bid" numeric(12, 2),
	"bid_kind" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "entity_name" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "guardrail" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "ad_changes" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "entity_name" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "winner_ad_id" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "run_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_entities_platform_id_uq" ON "ad_entities" USING btree ("platform","platform_id");--> statement-breakpoint
CREATE INDEX "ad_entities_parent_idx" ON "ad_entities" USING btree ("parent_id");