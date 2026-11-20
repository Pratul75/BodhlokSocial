import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { agentRuns, approvals, db, users, withTenant, workspacesOf, type TenantRef } from "@bodh/db";
import { count, eq, gte, sql as dsql } from "drizzle-orm";
import { requireOrgAdmin } from "@/lib/org-auth";
import { Card, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { NewClientForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "My clients" };

interface Row {
  tenant: TenantRef;
  people: number;
  pending: number;
  runs30d: number;
  tokens30d: number;
  usd30d: number;
  error?: string;
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * Each workspace read through its own read-only role, the same way the platform console reads
 * them. Counts and totals only — what the agency needs to run the account. The content lives
 * behind the workspace's own door, and an agency with an account there opens it the ordinary
 * way, from the switcher.
 */
async function numbersFor(tenant: TenantRef): Promise<Row> {
  const base = { tenant, people: 0, pending: 0, runs30d: 0, tokens30d: 0, usd30d: 0 };
  if (!tenant.dbRole) return { ...base, error: "No database role yet" };
  try {
    return await withTenant({ ...tenant, readOnly: true }, async () => {
      const [[people], [waiting], [ai]] = await Promise.all([
        db.select({ n: count() }).from(users).where(eq(users.active, true)),
        db.select({ n: count() }).from(approvals).where(eq(approvals.status, "pending")),
        db
          .select({
            n: count(),
            usd: dsql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float`,
            tokens: dsql<string>`coalesce(sum(${agentRuns.tokensIn} + ${agentRuns.tokensOut}), 0)::bigint`,
          })
          .from(agentRuns)
          .where(gte(agentRuns.startedAt, since(30))),
      ]);
      return {
        tenant,
        people: people?.n ?? 0,
        pending: waiting?.n ?? 0,
        runs30d: ai?.n ?? 0,
        tokens30d: Number(ai?.tokens ?? 0),
        usd30d: ai?.usd ?? 0,
      };
    });
  } catch (e) {
    // Named rather than reported as zero: on a page of numbers the two look identical, and only
    // one of them means the client is idle.
    return { ...base, error: e instanceof Error ? e.message.slice(0, 120) : "Could not read this workspace" };
  }
}

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-IN"));

export default async function OrgHome() {
  const { user, org } = await requireOrgAdmin();
  const workspaces = await workspacesOf(org.id);
  const rows: Row[] = [];
  for (const t of workspaces) rows.push(await numbersFor(t));

  const clients = rows.filter((r) => r.tenant.id !== user.tenant.id);
  const totalSpend = rows.reduce((n, r) => n + r.usd30d, 0);
  const totalTokens = rows.reduce((n, r) => n + r.tokens30d, 0);
  const waiting = rows.reduce((n, r) => n + r.pending, 0);

  return (
    <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Back to {user.tenant.name}
      </Link>
      <PageHeader
        eyebrow={org.name}
        title="My clients"
        description={`${workspaces.length} workspaces in this agency, including your own. Each one has its own schema, its own database role and its own credentials.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Clients</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{clients.length}</div>
          <div className="mt-1.5 text-xs text-muted">plus your own workspace</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Waiting for approval</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{waiting}</div>
          <div className="mt-1.5 text-xs text-muted">across every workspace</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Tokens</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(totalTokens)}</div>
          <div className="mt-1.5 text-xs text-muted">last 30 days</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">AI spend</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">${totalSpend.toFixed(2)}</div>
          <div className="mt-1.5 text-xs text-muted">last 30 days</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Workspaces" sub="Your own first. Open one from the switcher in the corner." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Workspace</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">People</th>
                <th className="px-3 py-2.5 font-medium">Waiting</th>
                <th className="px-3 py-2.5 font-medium">Tokens (30d)</th>
                <th className="px-5 py-2.5 text-right font-medium">AI (30d)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenant.id} className="border-b border-rule/60 last:border-0">
                  <td className="px-5 py-3">
                    <span className="font-medium">{r.tenant.name}</span>
                    {r.tenant.id === user.tenant.id && <span className="ml-2 text-xs text-muted">you are here</span>}
                    <div className="mt-0.5 font-mono text-xs text-muted">{r.tenant.slug}</div>
                    {r.error && <div className="mt-0.5 text-xs text-sindoor">{r.error}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill status={r.tenant.status} />
                  </td>
                  <td className="px-3 py-3 tabular">{r.error ? "—" : r.people}</td>
                  <td className="px-3 py-3 tabular">{r.error ? "—" : r.pending}</td>
                  <td className="px-3 py-3 font-mono tabular">{r.error ? "—" : short(r.tokens30d)}</td>
                  <td className="px-5 py-3 text-right font-mono tabular">{r.error ? "—" : `$${r.usd30d.toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="New client"
            sub="Its own schema, database role and tables, with every module switched on and ad spend capped at ₹0 until someone raises it. Everyone who runs this agency gets an account in it."
          />
          <NewClientForm />
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted">
        Numbers here are read live from each workspace through its read-only role. Nothing on this page reaches a
        client&rsquo;s content — posts, leads and messages are behind that workspace&rsquo;s own door, which you open from
        the switcher like anybody else who works there.
      </p>
    </main>
  );
}
