ALTER TABLE "campaigns" ADD COLUMN "platform_campaign_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_platform_campaign_id_unique" UNIQUE("platform_campaign_id");