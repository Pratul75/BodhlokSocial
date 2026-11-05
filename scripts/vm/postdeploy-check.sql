-- Read-only checks after deploying the audit merge. Compare the counts with the pre-deploy
-- baseline (scripts/prod-check.sh post does it): no existing table may have fewer rows.
\pset footer off
\echo == state
SELECT 'migrations applied (expect 13): ' || count(*) FROM drizzle.__drizzle_migrations;
SELECT 'new tables present (expect 2): ' || count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('directory_listings', 'reports');
SELECT 'leads: ' || count(*) || ' (' || count(*) FILTER (WHERE status = 'converted') || ' converted, ' || count(*) FILTER (WHERE status = 'open') || ' open)' FROM leads;
SELECT 'strategy plans: ' || coalesce(string_agg(month || ' ' || status, '; ' ORDER BY created_at), 'none') FROM strategy_plans;
SELECT 'connections: ' || string_agg(key || '=' || status, ', ' ORDER BY key) FROM connections WHERE status <> 'not_connected';
SELECT 'agent runs since deploy started: ' || count(*) || ' (' || count(*) FILTER (WHERE status = 'failed') || ' failed)' FROM agent_runs WHERE started_at > now() - interval '2 hours';
SELECT 'job runs since deploy started: ' || coalesce(string_agg(job || '=' || status, ', '), 'none') FROM (SELECT DISTINCT ON (job) job, status FROM pipeline_runs WHERE started_at > now() - interval '2 hours' ORDER BY job, started_at DESC) j;

\echo == row counts
SELECT 'count,' || table_name || ',' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;
