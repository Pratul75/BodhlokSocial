import { desc, eq } from "drizzle-orm";
import { db, leads, users } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { Card, PageHeader, Pill, StatusPill, Table } from "@/components/ui";
import { LeadRowForm } from "./lead-row-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };

const SOURCE: Record<string, string> = { meta_lead_form: "Meta lead form", google_lead_form: "Google lead form" };

export default async function LeadsPage() {
  await requireModule("leads");
  const [rows, people] = await Promise.all([
    db.select().from(leads).orderBy(desc(leads.createdAt)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
  ]);
  const now = new Date();
  const fresh = rows.filter((r) => r.status === "new").length;

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${fresh} new lead${fresh === 1 ? "" : "s"} from Meta and Google lead forms. Assign each one to someone on the sales team.`}
      />
      <Card>
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
                  <div className="font-mono text-xs whitespace-nowrap text-muted">{l.phone ?? l.email}</div>
                </td>
                <td className="min-w-[140px]">{l.interest}</td>
                <td className="whitespace-nowrap"><Pill>{SOURCE[l.source] ?? l.source}</Pill></td>
                <td className="whitespace-nowrap text-muted">{ago(l.createdAt, now)}</td>
                <td><StatusPill status={l.status} /></td>
                <td><LeadRowForm id={l.id} status={l.status} assignedTo={l.assignedTo} people={people} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
