import { entitlementsFor } from "@bodh/db";
import { FEATURE_KEYS, MODULES } from "@bodh/shared";
import { requireWorkspaceAdmin } from "@/lib/workspace-admin";
import { ConsoleCard } from "../../../ui";
import { EntitlementToggle } from "../../../forms";
import { AccessPresetForm } from "../../../workspace-forms";
import { presetChange, presetOf } from "../../../access-presets";

export const dynamic = "force-dynamic";

/** Which sections of the product this workspace has. Off means the page, its actions, its agents
 * and its scheduled jobs all refuse — not just the menu. */
export default async function WorkspaceModules({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, tenant } = await requireWorkspaceAdmin(id);
  const ent = await entitlementsFor(id);
  const preset = presetOf(ent.modules, ent.features, ent.integrations);
  // Worked out here so the console can say what a preset would change before anyone applies it.
  const changes = {
    full: presetChange("full", ent.modules, ent.features, ent.integrations),
    essentials: presetChange("essentials", ent.modules, ent.features, ent.integrations),
  };

  return (
    <>
      {viewer.canManage && (
        <div className="mb-4">
          <ConsoleCard title="Access level" sub="Full is everything. Essentials leaves out ad spend and the agents that act on their own.">
            <AccessPresetForm tenantId={id} current={preset} changes={changes} />
          </ConsoleCard>
        </div>
      )}

      <ConsoleCard
        title="Modules"
        sub={`${MODULES.filter((m) => ent.modules.has(m.key)).length} of ${MODULES.length} on for ${tenant.name}. Changes take effect within a minute, with no deploy.`}
      >
        <div className="px-5 py-2">
          {MODULES.map((m) => (
            <EntitlementToggle
              key={m.key}
              tenantId={id}
              kind="module"
              entKey={m.key}
              label={m.label}
              enabled={ent.modules.has(m.key)}
            />
          ))}
        </div>
      </ConsoleCard>

      <p className="mt-4 text-sm text-muted">
        {FEATURE_KEYS.filter((f) => ent.features.has(f)).length} of {FEATURE_KEYS.length} features are on as well — see
        the Features tab.
      </p>
    </>
  );
}
