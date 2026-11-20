import { desc, gte, sql } from "drizzle-orm";
import { agentRuns, auditLog, budgets, db, users } from "@bodh/db";
import { CHANNEL_LABELS, ROLE_LABELS, ROLES, type Channel } from "@bodh/shared";
import { enterTenantScope, requireModule } from "@/lib/auth";
import { ago, num } from "@/lib/format";
import { monthlyBudgetUsd } from "@bodh/agents";
import { Card, CardHeader, EmptyState, PageHeader, Pill, Table } from "@/components/ui";
import { AccessForm, AddUserForm, CapsForm, PasswordForm, RoleForm, WorkspaceSettingForm } from "./forms";
import { allowedDomains } from "@/lib/google";
import {
  storedSettings,
  tenantSetting,
  TENANT_SETTING_KEYS,
  TENANT_SETTING_LABELS,
  type TenantSettingKey,
} from "@bodh/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

/** What each setting is, in the words of someone setting it up for the first time. */
const SETTING_HINTS: Partial<Record<TenantSettingKey, string>> = {
  "ga4.property_id": "GA4 → Admin → Property details, the numeric id",
  "ga4.bq_project": "Google Cloud project holding the GA4 BigQuery export",
  "ga4.bq_dataset": "Usually analytics_<property id>",
  "search_console.site": "The property exactly as Search Console lists it",
  "google_ads.customer_id": "The advertiser account, digits only",
  "google_ads.login_customer_id": "The manager account, when access goes through one",
  "google_ads.conversion_actions": '{"registration":"123","activation":"456","paid":"789"}',
  "site.url": "Where approved pages are published, e.g. https://example.com",
  "auth.allowed_email_domains": "Comma-separated, e.g. example.com,example.co.uk",
  "seo.page_catalog": 'Type "on" to plan pages from the built-in catalogue',
};

export default async function AdminPage() {
  const me = enterTenantScope(await requireModule("admin"));
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [people, caps, usage, log, domains, aiBudget] = await Promise.all([
    db.select().from(users).orderBy(users.name),
    db.select().from(budgets),
    db
      .select({
        agent: agentRuns.agent,
        runs: sql<number>`count(*)::int`,
        tokens: sql<number>`sum(${agentRuns.tokensIn} + ${agentRuns.tokensOut})::int`,
        cost: sql<number>`sum(${agentRuns.costUsd})::float`,
      })
      .from(agentRuns)
      .where(gte(agentRuns.startedAt, monthStart))
      .groupBy(agentRuns.agent)
      .orderBy(sql`sum(${agentRuns.costUsd}) desc`),
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(30),
    allowedDomains(),
    monthlyBudgetUsd(),
  ]);

  // Stored tells the form what this workspace chose; effective says whether a blank field is
  // still answered by the server's own setting, so "empty" and "inherited" are not confused.
  const stored = await storedSettings(me.tenant.id);
  const effective: Partial<Record<TenantSettingKey, string | null>> = {};
  for (const key of TENANT_SETTING_KEYS) effective[key] = await tenantSetting(key);
  const settings = { stored, effective };
  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  // People whose access was removed stay in the workspace — their name is on everything they
  // did, and restoring them is one press. But they are not the list you read to see who can
  // sign in, so they are not in it.
  const active = people.filter((p) => p.active);
  const removed = people.filter((p) => !p.active);
  const totalCost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  const now = new Date();

  return (
    <>
      <PageHeader title="Admin" description="People and roles, spend caps, AI usage and the full audit log." />

      {/* People carries a five-column table, so it takes two thirds and AI usage takes the rest.
          Spend caps and Workspace settings each get a row of their own below: squeezed into a
          side column their fields had no room, and beside a workspace with one person in it a
          side column left a screen of empty space. */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={`People (${active.length})`} sub={`Only people added here can sign in. ${domains.map((d) => `@${d}`).join(" or ")} addresses use their company Google account; anyone else, such as a Gmail address, uses the Google account for the address you add — or a password, if you set one up for them.`} />
          <Table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th><span className="sr-only">Access</span></th></tr></thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-muted">
                    {p.email}
                    {p.phone && <div className="text-xs text-muted/80">{p.phone}</div>}
                  </td>
                  <td><RoleForm id={p.id} role={p.role} roles={roles} self={p.id === me.id} /></td>
                  <td>
                    <PasswordForm id={p.id} name={p.name} email={p.email} hasPassword={Boolean(p.passwordHash)} self={p.id === me.id} />
                  </td>
                  <td className="text-right"><AccessForm id={p.id} name={p.name} active={p.active} self={p.id === me.id} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-rule">
            <AddUserForm roles={roles} domain={domains[0] ?? "example.com"} />
          </div>

          {removed.length > 0 && (
            <div className="border-t border-rule">
              <CardHeader
                title="No longer has access"
                sub={`${removed.length} ${removed.length === 1 ? "person" : "people"} kept here because their name is on the work they did. Restoring access takes one press.`}
              />
              <Table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>
                      <span className="sr-only">Access</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="opacity-70">
                  {removed.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td className="text-muted">{p.email}</td>
                      <td className="text-muted">{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</td>
                      <td className="text-right">
                        <AccessForm id={p.id} name={p.name} active={p.active} self={p.id === me.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="AI usage this month" sub={`$${totalCost.toFixed(2)} of the $${aiBudget} monthly budget, across agents, chat and AI-visibility checks`} />
          {usage.length === 0 ? (
            <EmptyState title="No AI runs this month" />
          ) : (
          <Table>
            <thead><tr><th>Agent</th><th className="text-right">Runs</th><th className="text-right">Tokens</th><th className="text-right">Cost (USD)</th></tr></thead>
            <tbody className="font-mono text-[13px] tabular">
              {usage.map((u) => (
                <tr key={u.agent}>
                  <td className="font-sans text-sm">{u.agent.charAt(0).toUpperCase() + u.agent.slice(1)}</td>
                  <td className="text-right">{u.runs}</td>
                  <td className="text-right">{num(u.tokens ?? 0)}</td>
                  <td className="text-right">${(u.cost ?? 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Spend caps" sub="Hard limits per platform. The Ads agent can read these but never change them." />
          {/* The two platforms side by side: a row each left a card mostly empty. */}
          <div className="grid xl:grid-cols-2 xl:[&>*:nth-child(odd)]:border-r xl:[&>*]:border-rule [&>*]:border-t [&>*]:border-rule [&>*:first-child]:border-t-0 xl:[&>*:nth-child(2)]:border-t-0">
            {caps.map((c) => (
              <CapsForm key={c.platform} platform={c.platform} label={CHANNEL_LABELS[c.platform as Channel] ?? c.platform} dailyCap={c.dailyCap} monthlyCap={c.monthlyCap} />
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Workspace settings"
            sub="The accounts and addresses this workspace works with. Each belongs to this workspace alone; leave one empty to fall back to the server's own setting where there is one."
          />
          {/* Two to a row on a wide screen: ten settings in a single column is a tower. */}
          <div className="grid xl:grid-cols-2 xl:[&>*:nth-child(odd)]:border-r xl:[&>*]:border-rule [&>*]:border-t [&>*]:border-rule first:[&>*]:border-t-0 xl:[&>*:nth-child(2)]:border-t-0">
            {TENANT_SETTING_KEYS.map((key) => (
              <WorkspaceSettingForm
                key={key}
                settingKey={key}
                label={TENANT_SETTING_LABELS[key]}
                value={settings.stored.get(key) ?? ""}
                hint={SETTING_HINTS[key]}
                inherited={!settings.stored.get(key) && Boolean(settings.effective[key])}
              />
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Audit log" sub="Every action by people and agents: who, what, why and the result" />
        {log.length === 0 ? (
          <EmptyState title="Nothing logged yet" />
        ) : (
        <Table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Why</th><th>Result</th></tr></thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-muted">{ago(l.createdAt, now)}</td>
                <td><Pill tone={l.actorType === "agent" ? "dusk" : "neutral"}>{l.actor}</Pill></td>
                <td className="font-mono text-xs">{l.action}</td>
                <td className="max-w-[240px] truncate">{l.target}</td>
                <td className="max-w-[240px] truncate text-muted">{l.reason ?? ""}</td>
                <td className="text-muted">{l.result}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        )}
      </Card>
    </>
  );
}
