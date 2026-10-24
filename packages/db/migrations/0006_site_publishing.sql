ALTER TABLE "seo_pages" ADD COLUMN "site_status" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "site_category" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "site_pr_number" integer;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "site_pr_url" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "site_url" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "site_error" text;--> statement-breakpoint
ALTER TABLE "seo_pages" ADD COLUMN "site_published_at" timestamp with time zone;