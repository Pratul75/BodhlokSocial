"use client";

import { useRouter } from "next/navigation";

const field =
  "rounded-lg border border-rule bg-card px-3 py-2 text-sm text-ink focus:border-dusk focus:outline-none";

/** Narrowing the log by who, what and which workspace. Kept in the address, so a view is a link. */
export function AuditFilters({
  actor,
  action,
  workspace,
  actors,
  actions,
  workspaces,
}: {
  actor: string;
  action: string;
  workspace: string;
  actors: string[];
  actions: string[];
  workspaces: string[];
}) {
  const router = useRouter();
  const go = (next: { actor?: string; action?: string; workspace?: string }) => {
    const p = new URLSearchParams();
    const merged = { actor, action, workspace, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    router.replace(`/super-admin/audit${p.toString() ? `?${p}` : ""}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">
        <span className="sr-only">Filter by operator</span>
        <select value={actor} onChange={(e) => go({ actor: e.target.value })} className={field}>
          <option value="">Anyone</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="sr-only">Filter by action</span>
        <select value={action} onChange={(e) => go({ action: e.target.value })} className={field}>
          <option value="">Any action</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="sr-only">Filter by workspace</span>
        <select value={workspace} onChange={(e) => go({ workspace: e.target.value })} className={field}>
          <option value="">Any workspace</option>
          {workspaces.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      {(actor || action || workspace) && (
        <button
          onClick={() => router.replace("/super-admin/audit")}
          className="rounded-lg border border-rule bg-card px-3 py-2 text-sm font-medium hover:bg-paper"
        >
          Clear
        </button>
      )}
    </div>
  );
}
