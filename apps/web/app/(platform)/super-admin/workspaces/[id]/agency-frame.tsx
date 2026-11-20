import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, StatusPill } from "@/components/ui";
import { SwitchIntoClient } from "@/components/switch-into-client";
import { TabBar } from "../../nav";

/**
 * The same workspace tabs, framed for the agency rather than the platform.
 *
 * No console rail and no plumbing: an agency has no use for a schema name or a database role,
 * and showing them would only invite questions nobody there can answer. The tabs themselves are
 * the same pages the console shows, because they are the same pages.
 */
export function AgencyWorkspaceFrame({
  id,
  name,
  status,
  org,
  tabs,
  children,
}: {
  id: string;
  name: string;
  status: string;
  org: string;
  tabs: { href: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/org" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> My clients
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {org}
            <StatusPill status={status} />
          </span>
        }
        title={name}
        actions={<SwitchIntoClient tenantId={id} name={name} />}
      />
      <TabBar tabs={tabs} />
      <div className="pt-6">{children}</div>
    </main>
  );
}
