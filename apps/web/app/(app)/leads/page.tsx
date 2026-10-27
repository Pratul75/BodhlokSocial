import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { adEntities, connections, db, leads } from "@bodh/db";
import { CRM_URL } from "@bodh/integrations/crm";
import { channelLabel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago, daysAgo, inr, num, pct } from "@/lib/format";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Pill, Stat, StatusPill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };

const STATUS_PILL: Record<string, string> = { open: "new", converted: "won", lost: "lost", deleted: "removed" };

export default async function LeadsPage() {
  await requireModule("leads");
  const since = daysAgo(28);
  const [[conn], recent, byChannel] = await Promise.all([
    db.select().from(connections).where(eq(connections.key, "crm_leads")).limit(1),
    db.select().from(leads).where(eq(leads.kind, "lead")).orderBy(desc(leads.crmCreatedAt)).limit(100),
    db
      .select({
        channel: leads.channel,
        total: sql<number>`count(*)::int`,
        converted: sql<number>`count(*) filter (where ${leads.status} = 'converted')::int`,
        value: sql<number>`coalesce(sum(${leads.value}) filter (where ${leads.status} = 'converted'), 0)::float`,
      })
      .from(leads)
      .where(and(eq(leads.kind, "lead"), gte(leads.crmCreatedAt, since), sql`${leads.status} <> 'deleted'`))
      .groupBy(leads.channel)
      .orderBy(sql`count(*) desc`),
  ]);
  const adIds = [...new Set(recent.map((l) => l.fbAdId ?? l.fbCampaignId).filter((v): v is string => !!v))];
  const ads = adIds.length
    ? await db.select({ id: adEntities.platformId, name: adEntities.name }).from(adEntities).where(and(eq(adEntities.platform, "meta_ads"), inArray(adEntities.platformId, adIds)))
    : [];
  const adName = new Map(ads.map((a) => [a.id, a.name]));
  const total = byChannel.reduce((t, c) => t + c.total, 0);
  const converted = byChannel.reduce((t, c) => t + c.converted, 0);
  const connected = conn?.status === "connected";
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Leads"
        description="Enquiries from lead forms, web forms and WhatsApp, mirrored from the Agentic CRM, which owns them. Work a lead in the CRM; here it counts toward its channel and ad."
        actions={<LinkButton href={`${CRM_URL}/leads`}>Open the CRM</LinkButton>}
      />

      {!connected && recent.length === 0 ? (
        <Card>
          <EmptyState title="The CRM isn't connected yet" action={<LinkButton href="/connections" variant="primary">Go to Connections</LinkButton>}>
            Add the CRM lead webhook in the CRM (Settings → Webhooks) and paste its secret into Agentic CRM: leads in Connections. docs/crm.md has the steps.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="grid grid-cols-2 gap-6 px-5 py-4 sm:grid-cols-4">
              <Stat label="Leads, last 28 days" value={num(total)} />
              <Stat label="Converted in the CRM" value={num(converted)} sub={total ? pct(converted / total) : undefined} />
              <Stat label="From Meta lead ads" value={num(byChannel.find((c) => c.channel === "meta_ads")?.total ?? 0)} />
              <Stat label="Last received" value={recent[0] ? ago(recent[0].crmCreatedAt, now) : "—"} sub={conn?.error ? <span className="text-sindoor">{conn.error}</span> : undefined} />
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
            <Card>
              <CardHeader title="By channel" sub="Last 28 days" />
              {byChannel.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No leads in the last 28 days.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th className="text-right">Leads</th>
                      <th className="text-right">Converted</th>
                      <th className="text-right">Won value</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[13px] tabular">
                    {byChannel.map((c) => (
                      <tr key={c.channel}>
                        <td className="font-sans text-sm">{channelLabel(c.channel)}</td>
                        <td className="text-right">{num(c.total)}</td>
                        <td className="text-right">{num(c.converted)}</td>
                        <td className="text-right">{c.value ? inr(c.value) : <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card>
              <CardHeader title="Latest leads" sub="Names and contact details stay in the CRM" />
              {recent.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">No leads received yet.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>Source</th>
                      <th>Channel</th>
                      <th>Ad</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((l) => {
                      const ad = l.fbAdId ?? l.fbCampaignId ?? l.utmContent;
                      return (
                        <tr key={l.id}>
                          <td className="whitespace-nowrap text-muted">{ago(l.crmCreatedAt, now)}</td>
                          <td className="min-w-[120px]">{l.source ?? "—"}</td>
                          <td className="whitespace-nowrap"><Pill>{channelLabel(l.channel)}</Pill></td>
                          <td className="max-w-[220px] truncate text-xs text-muted" title={ad ?? undefined}>{ad ? (adName.get(ad) ?? ad) : "—"}</td>
                          <td><StatusPill status={STATUS_PILL[l.status] ?? l.status} /></td>
                          <td className="text-right">
                            <a href={`${CRM_URL}/leads/${l.crmLeadId}`} target="_blank" rel="noreferrer" className="text-sm whitespace-nowrap text-dusk hover:underline">
                              Open in CRM
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
