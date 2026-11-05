import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db, LEAD_STATUSES, leads, users } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader, Pill, StatusPill, Table } from "@/components/ui";
import { LeadRowForm } from "./lead-row-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };

const SOURCE: Record<string, string> = { meta_lead_form: "Meta lead form", google_lead_form: "Google lead form", manual: "Added by hand" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireModule("leads");
  const sp = await searchParams;
  const filter = (LEAD_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : null;
  const [rows, people, byStatus] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(filter ? eq(leads.status, filter) : undefined)
      .orderBy(desc(leads.createdAt))
      .limit(500),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
    db.select({ status: leads.status, n: count() }).from(leads).groupBy(leads.status),
  ]);
  const now = new Date();
  const n = (s: string) => byStatus.find((b) => b.status === s)?.n ?? 0;
  const total = byStatus.reduce((t, b) => t + b.n, 0);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const meta = Boolean(process.env.META_APP_SECRET && process.env.META_LEADS_VERIFY_TOKEN);
  const google = Boolean(process.env.GOOGLE_LEADS_WEBHOOK_KEY);

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${n("new")} new lead${n("new") === 1 ? "" : "s"} from Meta and Google lead forms. New leads go to the Sales person with the fewest leads this month; reassign them here.`}
      />

      {user.role === "admin" && (
        <Card className="mb-6">
          <CardHeader title="Lead form intake" sub="Leads arrive by webhook from each platform within seconds of someone submitting the form." />
          <ul className="space-y-3 px-5 py-4 text-sm">
            <li>
              <div className="flex items-center gap-2">Meta Lead Ads <StatusPill status={meta ? "connected" : "not_connected"} /></div>
              <p className="mt-1 text-xs text-muted">
                Callback URL <code className="font-mono">{base}/api/webhooks/meta-leads</code>, field <code className="font-mono">leadgen</code>. Needs META_APP_SECRET and META_LEADS_VERIFY_TOKEN on the server, and a Meta Marketing connection whose token has leads_retrieval.
              </p>
            </li>
            <li>
              <div className="flex items-center gap-2">Google Ads lead forms <StatusPill status={google ? "connected" : "not_connected"} /></div>
              <p className="mt-1 text-xs text-muted">
                Webhook URL <code className="font-mono">{base}/api/webhooks/google-leads</code> with the key in GOOGLE_LEADS_WEBHOOK_KEY. Use &ldquo;Send test data&rdquo; in Google Ads to check it.
              </p>
            </li>
          </ul>
        </Card>
      )}

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter by status">
        {[null, ...LEAD_STATUSES].map((s) => {
          const active = s === filter;
          return (
            <Link
              key={s ?? "all"}
              href={s ? `/leads?status=${s}` : "/leads"}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${active ? "bg-night text-white" : "bg-card text-muted ring-1 ring-rule hover:text-ink"}`}
            >
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : "All"} <span className="font-mono text-xs tabular opacity-70">{s ? n(s) : total}</span>
            </Link>
          );
        })}
      </nav>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filter ? `No ${filter} leads` : "No leads yet"}>
            {filter ? "Try another filter." : "Leads appear here as soon as someone fills in a Meta or Google lead form. An admin sets up the intake above."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Interested in</th>
                <th>Source</th>
                <th>Received</th>
                <th>Status</th>
                <th>Owner and status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="min-w-[140px] font-medium">{l.name}</div>
                    <div className="font-mono text-xs whitespace-nowrap text-muted">{[l.phone, l.email].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="min-w-[160px]">
                    {l.interest}
                    {l.campaign && <div className="text-xs text-muted">Campaign {l.campaign}</div>}
                    {l.fields.is_test === "true" && <Pill tone="turmeric">Test lead</Pill>}
                  </td>
                  <td className="whitespace-nowrap"><Pill>{SOURCE[l.source] ?? l.source}</Pill></td>
                  <td className="whitespace-nowrap text-muted">{ago(l.createdAt, now)}</td>
                  <td><StatusPill status={l.status} /></td>
                  <td><LeadRowForm id={l.id} status={l.status} assignedTo={l.assignedTo} people={people} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
