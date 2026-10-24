import { connections, db } from "@bodh/db";
import { INTEGRATIONS } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ConnectionCard, type ConnectionView } from "./connection-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  await requireModule("connections");
  const rows = await db.select().from(connections);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const now = new Date();

  const views: ConnectionView[] = INTEGRATIONS.map((i) => {
    const r = byKey.get(i.key);
    return {
      key: i.key,
      name: i.name,
      usedFor: i.usedFor,
      method: i.method,
      prerequisite: i.prerequisite,
      status: r?.status ?? "not_connected",
      accountLabel: r?.accountLabel ?? null,
      updatedLabel: r?.updatedAt ? ago(r.updatedAt, now) : null,
    };
  });
  const groups = [...new Set(INTEGRATIONS.map((i) => i.group))];
  const connected = views.filter((v) => v.status === "connected").length;

  return (
    <>
      <PageHeader
        title="Connections"
        description={`${connected} of ${views.length} connected. Agents can only use the accounts connected here.`}
      />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g} aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {views
                .filter((v) => INTEGRATIONS.find((i) => i.key === v.key)?.group === g)
                .map((v) => (
                  <ConnectionCard key={v.key} c={v} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
