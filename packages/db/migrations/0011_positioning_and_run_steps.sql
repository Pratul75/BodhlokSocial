ALTER TABLE "agent_runs" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD COLUMN "positioning" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD COLUMN "positioning_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD COLUMN "positioning_updated_at" timestamp with time zone;