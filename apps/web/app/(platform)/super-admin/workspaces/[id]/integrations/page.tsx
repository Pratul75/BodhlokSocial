import { connections, db, entitlementsFor, withTenant } from "@bodh/db";
import { INTEGRATIONS, MODULE_INTEGRATIONS, MODULES } from "@bodh/shared";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { EVENTS_SECRET_KEY, FEED_TOKEN_KEY, hasTenantSecret } from "@/lib/tenant-secrets";
import { ConsoleCard, ConsolePill, Empty, WhenText } from "../../../ui";
import { EntitlementToggle, PublicSecretForm } from "../../../forms";
import { loadWorkspace } from "../workspace";

export const dynamic = "force-dynamic";

const tone = (status: string) =>
  status === "connected" ? "leaf" : status === "error" ? "sindoor" : status === "planned" ? "neutral" : "turmeric";

/**
 * What this workspace has connected, and the two credentials the outside world uses to reach it.
 *
 * Every credential here belongs to this workspace alone — they are stored under its own name, so
 * connecting Google in one workspace does nothing to another.
 */
export default async function WorkspaceIntegrations({ params }: { params: Promise<{ id: string }> }) {
  const op = await requireOperator();
  const { id } = await params;
  const { tenant } = await loadWorkspace(id);
  await platformAudit({ actor: op.email, action: "view_tenant_integrations", target: tenant.slug, tenantId: id });

  let rows: { key: string; status: string; error: string | null; lastSyncAt: Date | null; accountLabel: string | null }[] = [];
  let secrets = { events: false, feed: false };
  let error: string | null = null;
  try {
    const read = { ...tenant, readOnly: true };
    rows = await withTenant(read, () => db.select().from(connections).orderBy(connections.key));
    secrets = await withTenant(read, async () => ({
      events: await hasTenantSecret(EVENTS_SECRET_KEY),
      feed: await hasTenantSecret(FEED_TOKEN_KEY),
    }));
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 160) : "Could not read this workspace's connections.";
  }

  const label = (key: string) => INTEGRATIONS.find((i) => i.key === key)?.name ?? key;
  const connected = rows.filter((r) => r.status === "connected");

  // What this workspace is allowed to connect at all, which is a different question from what
  // it has connected. Only what is granted here appears on the workspace's own Connections page.
  const ent = await entitlementsFor(id);
  const granted = (key: string) => ent.unrestricted === true || ent.integrations.has(key);
  const groups = [...new Set(INTEGRATIONS.map((i) => i.group))];
  // Which modules each account carries, so switching one off is not a guess.
  const usedBy = (key: string) =>
    MODULES.filter((m) => (MODULE_INTEGRATIONS[m.key] ?? []).includes(key))
      .map((m) => m.label)
      .join(", ");

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-sindoor-soft px-4 py-3 text-sm text-sindoor">{error}</p>}

      {op.role === "owner" && (
        <div className="mb-6">
          <ConsoleCard
            title="What this workspace may connect"
            sub={`${INTEGRATIONS.filter((i) => granted(i.key)).length} of ${INTEGRATIONS.length} allowed. What is off here never appears on their Connections page, and the connect route refuses it — so no credential for it can exist in this workspace.`}
          >
            <div className="px-5 py-2">
              {groups.map((g) => (
                <div key={g} className="py-2">
                  <p className="pb-1 text-xs font-medium tracking-wide text-muted uppercase">{g}</p>
                  {INTEGRATIONS.filter((i) => i.group === g).map((i) => (
                    <EntitlementToggle
                      key={i.key}
                      tenantId={id}
                      kind="integration"
                      entKey={i.key}
                      label={i.name}
                      enabled={granted(i.key)}
                      note={usedBy(i.key) || undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          </ConsoleCard>
        </div>
      )}

      <ConsoleCard
        title="Connections"
        sub={`${connected.length} connected of ${rows.length}. Each credential is stored under this workspace's own name.`}
      >
        {rows.length === 0 ? (
          <Empty>{error ? "Could not read them." : "This workspace has no connection rows yet."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Service</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Last sync</th>
                  <th className="px-5 py-2.5 font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-rule/60 last:border-0">
                    <td className="px-5 py-3">
                      <span className="font-medium">{label(r.key)}</span>
                      <div className="mt-0.5 font-mono text-xs text-muted">{r.key}</div>
                    </td>
                    <td className="px-3 py-3">
                      <ConsolePill tone={tone(r.status)}>{r.status}</ConsolePill>
                      {r.error && <p className="mt-1 max-w-xs text-xs text-sindoor">{r.error}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <WhenText at={r.lastSyncAt} />
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">{r.accountLabel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleCard>

      <div className="mt-6">
        <ConsoleCard
          title="Public endpoints"
          sub="What guards the addresses the outside world calls for this workspace. Each value is shown once when it is made; replacing it stops the old one at once."
        >
          <div className="px-5 py-2">
            <PublicSecretForm
              tenantId={id}
              secretKey={EVENTS_SECRET_KEY}
              label={`Event webhook secret — /t/${tenant.slug}/api/events/bodh`}
              present={secrets.events}
            />
            <PublicSecretForm
              tenantId={id}
              secretKey={FEED_TOKEN_KEY}
              label={`Page feed token — /t/${tenant.slug}/api/feed/…`}
              present={secrets.feed}
            />
          </div>
        </ConsoleCard>
      </div>
    </>
  );
}
