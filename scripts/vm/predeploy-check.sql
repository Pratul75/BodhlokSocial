-- Read-only checks before deploying the audit merge (migration 0012) onto the live database.
-- Run with default_transaction_read_only=on (scripts/prod-check.sh does). Every "blocking" line
-- must be 0, or 0012 would fail (and roll back) at deploy.
\pset footer off
\echo == state
SELECT 'migrations applied: ' || count(*) FROM drizzle.__drizzle_migrations;
SELECT 'agent runs queued or running (must be 0): ' || count(*) FROM agent_runs WHERE status IN ('queued', 'running');
SELECT 'leads: ' || count(*) || ' (' || count(*) FILTER (WHERE status = 'converted') || ' converted, ' || count(*) FILTER (WHERE status = 'open') || ' open)' FROM leads;
SELECT 'strategy plans: ' || coalesce(string_agg(month || ' ' || status, '; ' ORDER BY created_at), 'none') FROM strategy_plans;

\echo == blocking: values the new CHECK rules would reject
SELECT 'users.role: ' || count(*) FROM users WHERE role NOT IN ('admin', 'ads_manager', 'seo_manager', 'social_manager', 'sales');
SELECT 'connections.status: ' || count(*) FROM connections WHERE status NOT IN ('not_connected', 'connected', 'error', 'pending_review');
SELECT 'approvals.kind: ' || count(*) FROM approvals WHERE kind NOT IN ('post', 'ad_change', 'reply', 'listing', 'blog', 'page');
SELECT 'approvals.status: ' || count(*) FROM approvals WHERE status NOT IN ('pending', 'approved', 'rejected', 'withdrawn');
SELECT 'calendar_items.status: ' || count(*) FROM calendar_items WHERE status NOT IN ('idea', 'drafted', 'in_review', 'approved', 'scheduled', 'published', 'failed');
SELECT 'community_items.status: ' || count(*) FROM community_items WHERE status NOT IN ('found', 'drafted', 'in_review', 'approved', 'posted', 'skipped', 'failed');
SELECT 'strategy_plans.status: ' || count(*) FROM strategy_plans WHERE status NOT IN ('draft', 'approved', 'superseded');
SELECT 'brand_kit rows other than id 1: ' || count(*) FROM brand_kit WHERE id <> 1;

\echo == blocking: references the new foreign keys would reject
SELECT 'ad_changes.approval_id: ' || count(*) FROM ad_changes WHERE approval_id IS NOT NULL AND approval_id NOT IN (SELECT id FROM approvals);
SELECT 'ad_changes.run_id: ' || count(*) FROM ad_changes WHERE run_id IS NOT NULL AND run_id NOT IN (SELECT id FROM agent_runs);
SELECT 'approvals.calendar_item_id: ' || count(*) FROM approvals WHERE calendar_item_id IS NOT NULL AND calendar_item_id NOT IN (SELECT id FROM calendar_items);
SELECT 'assets.job_id: ' || count(*) FROM assets WHERE job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM creative_jobs);
SELECT 'brand_kit.logo_asset_id: ' || count(*) FROM brand_kit WHERE logo_asset_id IS NOT NULL AND logo_asset_id NOT IN (SELECT id FROM assets);
SELECT 'experiments.run_id: ' || count(*) FROM experiments WHERE run_id IS NOT NULL AND run_id NOT IN (SELECT id FROM agent_runs);
SELECT 'postiz_calls.calendar_item_id: ' || count(*) FROM postiz_calls WHERE calendar_item_id IS NOT NULL AND calendar_item_id NOT IN (SELECT id FROM calendar_items);
SELECT 'seo_pages.run_id: ' || count(*) FROM seo_pages WHERE run_id IS NOT NULL AND run_id NOT IN (SELECT id FROM agent_runs);
SELECT 'community_items.run_id (column added by 0012, must not exist yet): ' || count(*) FROM information_schema.columns WHERE table_name = 'community_items' AND column_name = 'run_id';

\echo == row counts (saved as the baseline)
SELECT 'count,' || table_name || ',' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;
