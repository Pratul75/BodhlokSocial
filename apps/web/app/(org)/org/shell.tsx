import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/legal";
import { ConsoleMark } from "@/app/(platform)/super-admin/mark";
import { AgencyNav } from "./nav";

export interface AgencyCrumb {
  label: string;
  href?: string;
}

/**
 * The agency's frame, built to the platform console's own measurements: the same dark rail at
 * the same width, the same thin top bar, the same single content column.
 *
 * Running four clients and running forty is the same job, and somebody who has seen one of
 * these panels should not have to learn the other. The rail carries the same questions, asked
 * about one agency: its clients where the console has every workspace, the people who run it
 * where the console has operators. What differs is the way out, which for an agency goes back
 * to its own workspace rather than to a sign-in page.
 */
export function AgencyShell({
  orgName,
  workspaceName,
  email,
  title,
  description,
  crumbs = [],
  actions,
  clients,
  children,
}: {
  orgName: string;
  workspaceName: string;
  email: string;
  title: string;
  description?: ReactNode;
  crumbs?: AgencyCrumb[];
  actions?: ReactNode;
  /** How many workspaces this agency holds, for the rail's badge. */
  clients: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="bg-night text-white lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="text-turmeric">
            <ConsoleMark />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate font-display text-[17px] font-semibold tracking-tight">{orgName}</div>
            <div className="text-[11px] text-night-3">{PRODUCT_NAME}</div>
          </div>
        </div>
        <AgencyNav clients={clients} />
        <div className="hidden items-center justify-between gap-2 border-t border-white/10 px-5 py-4 text-xs text-night-3 lg:flex">
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{email}</div>
            <div>Agency</div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-card/70 px-4 py-2.5 backdrop-blur sm:px-8">
          <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/org" className="hover:text-ink">
                  {orgName}
                </Link>
              </li>
              {crumbs.map((c) => (
                <li key={c.label} className="flex items-center gap-1.5">
                  <span aria-hidden="true">/</span>
                  {c.href ? (
                    <Link href={c.href} className="hover:text-ink">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="text-ink">{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-rule px-2.5 py-1.5 text-xs font-medium hover:bg-paper"
          >
            <ArrowLeft size={14} />
            Back to {workspaceName}
          </Link>
        </header>

        <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">{title}</h1>
              {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
