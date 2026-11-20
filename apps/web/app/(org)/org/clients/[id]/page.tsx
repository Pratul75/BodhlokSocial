import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { accessLevel, agentRuns, db, entitlementsFor, tenantById, users, withTenant } from "@bodh/db";
import { capacity, FEATURE_KEYS, MODULES } from "@bodh/shared";
import { count, gte, sql as dsql } from "drizzle-orm";
import { requireOrgAdmin } from "@/lib/org-auth";
import { Card, CardHeader, EmptyState, PageHeader, Pill, StatusPill } from "@/components/ui";
import { SwitchIntoClient } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client" };

const since = (days: number) => new Date(Date.now() - days * 86_400_000);
const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-IN");

/**
 * One client, as its agency sees it: who works there, what it may use, what it has been
 * spending — read through that workspace's read-only role, so the database refuses a write
 * from this page whatever the code does.
 *
 * Content is not here and cannot be: posts, leads, approvals and messages are behind the
 * workspace's own door. An agency with an account there opens it from the switcher and works
 * as itself, which is visible to the client on its own People page.
 */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, org } = await requireOrgAdmin();
  const { id } = await params;

  const tenant = await tenantById(id);
  // A workspace from another agency is not refused with an explanation — it is not found. An
  // agency should not be able to learn that another agency's client exists by trying its id.
  if (!tenant || tenant.orgId !== org.id) notFound();
  const level = tenant.id === user.tenant.id ? "full" : await accessLevel(org.id, tenant.id);
  if (level === "none") notFound();

  const ent = await entitlementsFor(tenant.id);
  const modulesOn = MODULES.filter((m) => ent.modules.has(m.key));
  const featuresOn = FEATURE_KEYS.filter((f) => ent.features.has(f)).length;
  const budget = capacity(ent, "ai.monthly_budget_usd");

  let people: { email: string; name: string; role: string; active: boolean }[] = [];
  let runs = 0;
  let tokens = 0;
  let usd = 0;
  let error: string | null = null;
  try {
    await withTenant({ ...tenant, readOnly: true }, async () => {
      people = await db
        .select({ email: users.email, name: users.name, role: users.role, active: users.active })
        .from(users)
        .orderBy(users.email);
      const [ai] = await db
        .select({
          n: count(),
          usd: dsql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float`,
          tokens: dsql<string>`coalesce(sum(${agentRuns.tokensIn} + ${agentRuns.tokensOut}), 0)::bigint`,
        })
        .from(agentRuns)
        .where(gte(agentRuns.startedAt, since(30)));
      runs = ai?.n ?? 0;
      usd = ai?.usd ?? 0;
      tokens = Number(ai?.tokens ?? 0);
    });
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 160) : "Could not read this workspace.";
  }

  return (
    <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/org" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> My clients
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {org.name}
            <StatusPill status={tenant.status} />
            {level === "manage" && <Pill tone="turmeric">Numbers only</Pill>}
          </span>
        }
        title={tenant.name}
        description={
          level === "full"
            ? "You have an account in this workspace. Open it from the switcher in the corner to work there."
            : "You can see this client's numbers. You have no account inside it, so there is nothing here to open."
        }
        actions={level === "full" && tenant.id !== user.tenant.id ? <SwitchIntoClient tenantId={tenant.id} name={tenant.name} /> : undefined}
      />

      {error && <p className="mb-4 rounded-lg bg-sindoor-soft px-4 py-3 text-sm text-sindoor">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">People</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">
            {people.filter((p) => p.active).length}
          </div>
          <div className="mt-1.5 text-xs text-muted">{people.length - people.filter((p) => p.active).length} removed</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Modules</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">
            {modulesOn.length}/{MODULES.length}
          </div>
          <div className="mt-1.5 text-xs text-muted">{featuresOn} features on</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Tokens</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(tokens)}</div>
          <div className="mt-1.5 text-xs text-muted">{runs} runs, last 30 days</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">AI spend</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">${usd.toFixed(2)}</div>
          <div className="mt-1.5 text-xs text-muted">of ${budget} a month</div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Who works here" sub="Everyone with an account in this workspace, including yours" />
          {people.length === 0 ? (
            <EmptyState title="Nobody yet">{error ? "This workspace could not be read." : "Its first admin has not been added."}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {people.map((p) => (
                  <tr key={p.email} className="border-b border-rule/60 last:border-0">
                    <td className="px-5 py-2.5">
                      <div className={p.active ? "" : "text-muted line-through"}>{p.name}</div>
                      <div className="font-mono text-xs text-muted">{p.email}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted capitalize">{p.role.replace("_", " ")}</td>
                    <td className="px-5 py-2.5 text-right text-xs">{p.active ? "" : <span className="text-muted">removed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="What it may use" sub="Set by the platform, the same for every workspace on its plan" />
          <div className="flex flex-wrap gap-1.5 px-5 py-4">
            {modulesOn.map((m) => (
              <Pill key={m.key}>{m.label}</Pill>
            ))}
          </div>
          <p className="px-5 pb-5 text-xs text-muted">
            Which modules a workspace has is the platform&rsquo;s to set, not the agency&rsquo;s. Ask them to change it.
          </p>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted">
        Everything on this page is read through this workspace&rsquo;s read-only database role, so nothing here can change
        it. Its posts, leads and messages are not here at all.
      </p>
    </main>
  );
}
