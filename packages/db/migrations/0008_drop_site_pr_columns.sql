ALTER TABLE "seo_pages" DROP COLUMN "site_pr_number";--> statement-breakpoint
ALTER TABLE "seo_pages" DROP COLUMN "site_pr_url";--> statement-breakpoint
DELETE FROM "connections" WHERE "key" = 'github_site';
