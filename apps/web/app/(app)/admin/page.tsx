import { desc, gte, sql } from "drizzle-orm";
import { agentRuns, auditLog, budgets, db, users } from "@bodh/db";
import { CHANNEL_LABELS, ROLE_LABELS, ROLES, type Channel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago, num } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill, Table } from "@/components/ui";
import { AccessForm, AddUserForm, CapsForm, RoleForm } from "./forms";
import { allowedDomains } from "@/lib/google";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const me = await requireModule("admin");
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [people, caps, usage, log] = await Promise.all([
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
  ]);
  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const totalCost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  const now = new Date();

  return (
    <>
      <PageHeader title="Admin" description="People and roles, spend caps, AI usage and the full audit log." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="People" sub={`Only people added here can sign in, with an ${allowedDomains().map((d) => `@${d}`).join(" or ")} Google account`} />
          <Table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th><span className="sr-only">Access</span></th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <td className="font-medium">{p.name}{!p.active && <span className="ml-2 text-xs font-normal text-muted">No access</span>}</td>
                  <td className="text-muted">{p.email}</td>
                  <td><RoleForm id={p.id} role={p.role} roles={roles} self={p.id === me.id} /></td>
                  <td className="text-right"><AccessForm id={p.id} active={p.active} self={p.id === me.id} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-rule">
            <AddUserForm roles={roles} domain={allowedDomains()[0] ?? "rechargestudio.com"} />
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Spend caps" sub="Hard limits per platform. The Ads agent can read these but never change them." />
            <div className="divide-y divide-rule">
              {caps.map((c) => (
                <CapsForm key={c.platform} platform={c.platform} label={CHANNEL_LABELS[c.platform as Channel] ?? c.platform} dailyCap={c.dailyCap} monthlyCap={c.monthlyCap} />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="AI usage this month" sub={`$${totalCost.toFixed(2)} across all agents`} />
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
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Audit log" sub="Every action by people and agents: who, what, why and the result" />
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
      </Card>
    </>
  );
}
