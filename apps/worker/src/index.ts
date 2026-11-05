import { serve } from "@hono/node-server";
import { failStaleRuns } from "@bodh/agents";
import { checkDataForSeoConnection, ensurePageCatalog } from "@bodh/integrations/seo";
import { createApp, tokenProblem } from "./app";
import { log } from "./log";

const token = process.env.WORKER_TOKEN;
const problem = tokenProblem(token, process.env.NODE_ENV);
if (problem) throw new Error(problem);

const app = createApp(token!);

const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 8787);
// Cloud Run needs 0.0.0.0; on a shared VM set WORKER_HOST=127.0.0.1 so only local jobs can reach it.
const hostname = process.env.WORKER_HOST ?? "0.0.0.0";
serve({ fetch: app.fetch, port, hostname }, (info) => log.info("worker listening", { hostname, port: info.port }));

failStaleRuns()
  .then((n) => n && log.info("marked interrupted runs as failed", { runs: n }))
  .catch((e) => log.error("failStaleRuns", e));
ensurePageCatalog()
  .then((n) => n && log.info("added planned SEO pages", { pages: n }))
  .then(checkDataForSeoConnection)
  .catch((e) => log.error("SEO start-up", e));
