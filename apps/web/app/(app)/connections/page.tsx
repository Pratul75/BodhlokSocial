import { connections, db } from "@bodh/db";
import { INTEGRATIONS } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { authEnabled } from "@/lib/session";
import { getIntegration } from "@bodh/shared";
import { ago } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { ConnectionCard, type ConnectionView } from "./connection-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

const MESSAGES: Record<string, string> = {
  admin_only: "Only admins can connect accounts.",
  no_oauth_client: "Google sign-in isn't configured, so Google accounts can't be connected yet.",
  not_enabled: "That connection isn't switched on yet.",
  cancelled: "The connection was cancelled in Google.",
  expired: "The connection took too long. Try again.",
  no_refresh_token: "Google didn't return offline access. Remove BODH Growth from your Google account's third-party access, then connect again.",
  scopes: "Some permissions were unticked on Google's screen. Connect again and allow all of them.",
  failed: "Google connected, but checking the account failed. The error is shown on the card.",
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
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
      syncedLabel: r?.lastSyncAt ? ago(r.lastSyncAt, now) : null,
      error: r?.error ?? null,
      oauthEnabled: Boolean(i.googleOAuth?.enabled),
      hasCredential: Boolean(r?.secretRef),
      oauthClientReady: authEnabled(),
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
      {sp.connected && (
        <p className="mb-6 rounded-xl bg-leaf-soft px-5 py-3 text-sm text-leaf" role="status">
          {getIntegration(sp.connected)?.name ?? "Account"} connected.
        </p>
      )}
      {sp.error && MESSAGES[sp.error] && (
        <p className="mb-6 rounded-xl bg-sindoor-soft px-5 py-3 text-sm text-sindoor" role="alert">{MESSAGES[sp.error]}</p>
      )}
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
