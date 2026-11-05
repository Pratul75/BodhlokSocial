import { connections, db } from "@bodh/db";
import { INTEGRATIONS } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { authEnabled } from "@/lib/session";
import { getIntegration } from "@bodh/shared";
import { ago } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { CheckAllConnections } from "./check-all";
import { ConnectionCard, type ConnectionView } from "./connection-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

/** Pasted-key connections that "Sync now" can check or pull (see lib/integrations/google-connection.ts). */
const SYNCABLE = new Set(["bodhlok_cms", "crm_billing", "crm_leads"]);

const NOTES: Record<string, string> = {
  postiz_app: `Redirect URL for the Postiz app: ${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/connect/postiz/callback`,
  reddit_app: `Redirect URL for the Reddit app: ${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/connect/reddit/callback`,
  google_app: `Create it in a Google Cloud project of its own, not the staff sign-in project: Google Auth Platform, audience External, then a Web application client with the redirect URL ${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/connect/google/callback. Paste the client ID and secret here. New connections then go through this app; connections made before keep working on the old one until you reconnect them. Removing this card breaks every connection made through it. Verification steps: docs/google-verification.md.`,
  bodhlok_cms:
    "To verify: in a private browser window, log in at bodhlok.com as the Growth OS account (you pass reCAPTCHA there). Then open the browser console on bodhlok.com (Cmd+Option+J in Chrome), type copy(localStorage.refresh_token) and press Enter: the sign-in key is now on your clipboard. Paste it here and close the window without logging out. Growth OS renews the key every hour; if it ever lapses, this card asks you to do this again.",
};

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
      fields: i.fields,
      prerequisite: i.prerequisite,
      planned: i.planned,
      status: r?.status ?? "not_connected",
      accountLabel: r?.accountLabel ?? null,
      updatedLabel: r?.updatedAt ? ago(r.updatedAt, now) : null,
      syncedLabel: r?.lastSyncAt ? ago(r.lastSyncAt, now) : null,
      error: r?.error ?? null,
      oauthEnabled: Boolean(i.googleOAuth?.enabled),
      canSync: Boolean(i.googleOAuth?.enabled) || SYNCABLE.has(i.key),
      hasCredential: Boolean(r?.secretRef),
      oauthClientReady: authEnabled() || byKey.get("google_app")?.status === "connected",
      postizSignIn: i.key === "postiz" && byKey.get("postiz_app")?.status === "connected",
      customOAuth: i.customOAuth,
      customOAuthReady: i.customOAuth === "reddit" && byKey.get("reddit_app")?.status === "connected",
      note: NOTES[i.key],
    };
  });
  const groups = [...new Set(INTEGRATIONS.map((i) => i.group))];
  const connected = views.filter((v) => v.status === "connected").length;

  return (
    <>
      <PageHeader
        title="Connections"
        description={`${connected} of ${views.length} connected. Agents can only use the accounts connected here. "Connected" means the provider accepted the credential when it was saved or last checked.`}
        actions={<CheckAllConnections />}
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
