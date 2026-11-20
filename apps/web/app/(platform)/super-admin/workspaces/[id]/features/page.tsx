import { entitlementsFor } from "@bodh/db";
import { FEATURE_KEYS, FEATURE_LABELS, featuresOfModule, MODULES } from "@bodh/shared";
import { requireWorkspaceAdmin } from "@/lib/workspace-admin";
import { ConsoleCard } from "../../../ui";
import { EntitlementToggle } from "../../../forms";

export const dynamic = "force-dynamic";

/**
 * The capabilities inside the modules: what may reach an outside service, spend money or act
 * without a person. Each is checked where the work happens, so an agent and a scheduled job are
 * refused by the same switch that refuses a button.
 *
 * Grouped by the module each belongs to, because that relationship is not guessable from the
 * names — "Publish approved SEO pages to the website CMS" is the SEO module's, and the Mentions
 * agent is too — and switching a module off takes its features with it. Seeing which features
 * sit under a module is the only way that stops being a surprise.
 */
export default async function WorkspaceFeatures({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requireWorkspaceAdmin(id);
  const ent = await entitlementsFor(id);

  // Only the modules that own something, in the order the product lists them.
  const owners = MODULES.map((m) => ({ module: m, features: featuresOfModule(m.key) })).filter((g) => g.features.length);
  const on = FEATURE_KEYS.filter((f) => ent.features.has(f)).length;

  return (
    <ConsoleCard
      title="What this workspace may do"
      sub={`${on} of ${FEATURE_KEYS.length} on, grouped by the module each belongs to. Switching a module off switches its features off with it; switching it back on does not bring them back.`}
    >
      <div className="grid lg:grid-cols-2 lg:[&>*:nth-child(odd)]:border-r lg:[&>*]:border-rule [&>*]:border-t [&>*]:border-rule [&>*:first-child]:border-t-0 lg:[&>*:nth-child(2)]:border-t-0">
        {owners.map(({ module, features }) => {
          const moduleOn = ent.modules.has(module.key);
          return (
            <div key={module.key} className="px-5 py-3">
              <p className="flex items-baseline gap-2 pb-1 text-xs font-medium tracking-wide uppercase">
                <span className={moduleOn ? "text-muted" : "text-muted/60"}>{module.label}</span>
                {!moduleOn && <span className="text-[11px] normal-case text-turmeric-ink">module is off</span>}
              </p>
              {features.map((f) => (
                <EntitlementToggle
                  key={f}
                  tenantId={id}
                  kind="feature"
                  entKey={f}
                  label={FEATURE_LABELS[f]}
                  enabled={ent.features.has(f)}
                  // A feature of a module that is off does nothing, and should look like it.
                  inertBecause={moduleOn ? undefined : `${module.label} is off`}
                />
              ))}
            </div>
          );
        })}
      </div>
      <p className="border-t border-rule px-5 py-3 text-xs text-muted">
        {tenant.name} is billed for what its agents spend, against the monthly budget on the Usage tab. An agent that
        is off cannot be started from anywhere, including its own schedule.
      </p>
    </ConsoleCard>
  );
}
