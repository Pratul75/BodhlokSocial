CREATE TABLE "brand_kit" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"palette" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo_asset_id" uuid,
	"image_style" text DEFAULT '' NOT NULL,
	"voice" text DEFAULT '' NOT NULL,
	"banned_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stamp_logo" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"operation_name" text,
	"asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "postiz_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"calendar_item_id" uuid,
	"ok" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_channels" (
	"channel" text PRIMARY KEY NOT NULL,
	"postiz_integration_id" text NOT NULL,
	"postiz_identifier" text NOT NULL,
	"name" text NOT NULL,
	"picture" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "calendar_item_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "creative_jobs_status_idx" ON "creative_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "postiz_calls_at_idx" ON "postiz_calls" USING btree ("at");