import { storedSettings, tenantSetting, TENANT_SETTING_KEYS, TENANT_SETTING_LABELS, withTenant, type TenantSettingKey, archiveInfo } from "@bodh/db";
import { platformAudit } from "@/lib/platform-auth";
import { requireWorkspaceAdmin } from "@/lib/workspace-admin";
import { ConsoleCard } from "../../../ui";
import { PlanForm, RenameWorkspaceForm, WorkspaceSettingForm } from "../../../workspace-forms";
import { PurgeWorkspaceForm } from "../../../forms";

export const dynamic = "force-dynamic";

/** What each setting is, in the words of somebody setting one up for the first time. */
const HINTS: Partial<Record<TenantSettingKey, string>> = {
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

/**
 * The accounts and addresses this workspace works with.
 *
 * The same values its own admin edits, editable here too — an operator setting a customer up
 * before handing it over should not have to sign in as them to do it.
 */
export default async function WorkspaceSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, tenant, plan } = await requireWorkspaceAdmin(id);
  const archive = tenant.status === "archived" ? await archiveInfo(id) : null;
  await platformAudit({ actor: viewer.email, action: "view_tenant_settings", target: tenant.slug, tenantId: id });

  const stored = await storedSettings(id);
  // Whether a blank field is still answered by the server's own setting, so "empty" and
  // "inherited" are not shown as the same thing.
  const effective = new Map<TenantSettingKey, string | null>();
  await withTenant(tenant, async () => {
    for (const key of TENANT_SETTING_KEYS) effective.set(key, await tenantSetting(key));
  });

  return (
    <>
      <ConsoleCard title="Workspace" sub="What this workspace is called, and what you are charging it for">
        <div>
          {viewer.canManage ? (
            <>
              <RenameWorkspaceForm tenantId={id} name={tenant.name} />
              <PlanForm tenantId={id} plan={plan} />
            </>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">Only an owner can rename a workspace or change its plan.</p>
          )}
          <div className="grid gap-2 border-b border-rule/60 px-5 py-3 sm:grid-cols-[260px_1fr] sm:items-center">
            <div className="text-sm font-medium">
              Address
              <p className="mt-0.5 text-xs font-normal text-muted">Fixed: the schema and every stored credential key on it.</p>
            </div>
            <div className="font-mono text-sm">/t/{tenant.slug}</div>
          </div>
        </div>
      </ConsoleCard>

      <div className="mt-6">
        <ConsoleCard
          title="Accounts and addresses"
          sub="Each belongs to this workspace alone. Leave one empty to fall back to the server's own setting, where there is one."
        >
          <div>
            {TENANT_SETTING_KEYS.map((key) => (
              <WorkspaceSettingForm
                key={key}
                tenantId={id}
                settingKey={key}
                label={TENANT_SETTING_LABELS[key]}
                value={stored.get(key) ?? ""}
                hint={HINTS[key]}
                inherited={!stored.get(key) && Boolean(effective.get(key))}
              />
            ))}
          </div>
        </ConsoleCard>
      </div>
      {tenant.status === "archived" && archive && (
        <div className="mt-6">
          <ConsoleCard title="Archived" sub="What was kept, and when it can be removed for good.">
            <PurgeWorkspaceForm
              id={id}
              slug={tenant.slug}
              name={tenant.name}
              schema={tenant.dataSchema}
              purgeAfter={archive.purgeAfter?.toISOString() ?? null}
              archivedAt={archive.archivedAt?.toISOString() ?? null}
              archivedBy={archive.archivedBy}
              reason={archive.reason}
            />
          </ConsoleCard>
        </div>
      )}
    </>
  );
}
