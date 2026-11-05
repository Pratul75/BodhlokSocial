-- Runs left queued or running (including rows for agents that were never built) would break the
-- unique index below. A deploy restarts the worker, which fails unfinished runs anyway.
UPDATE "agent_runs" SET "status" = 'failed', "summary" = 'Stopped: closed by migration 0007 (deploy).', "finished_at" = now() WHERE "status" in ('queued', 'running') AND "agent" <> 'chat';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_idx" ON "agent_runs" USING btree ("agent") WHERE "agent_runs"."status" in ('queued', 'running') and "agent_runs"."agent" <> 'chat';--> statement-breakpoint
CREATE INDEX "agent_runs_agent_started_idx" ON "agent_runs" USING btree ("agent","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("started_at");