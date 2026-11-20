import Link from "next/link";
import type { ReactNode } from "react";
import { ownerSql } from "@bodh/db";
import { PRODUCT_NAME } from "@/lib/legal";
import type { Operator } from "@/lib/platform-auth";
import { ConsoleMark } from "./mark";
import { ConsoleNav, OperatorMenu } from "./nav";

export interface ConsoleCrumb {
  label: string;
  href?: string;
}

/**
 * The console's frame: the same sidebar and top bar on every page, so an operator always knows
 * where they are and can get anywhere in one click. Deliberately the tenant app's shell in
 * shape — a dark rail, a thin top bar, one content column — because the two are one product and
 * an operator moving between them should not have to relearn anything.
 */
export async function ConsoleShell({
  operator,
  title,
  description,
  crumbs = [],
  actions,
  children,
}: {
  operator: Operator;
  title: string;
  description?: ReactNode;
  crumbs?: ConsoleCrumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const counts = (await ownerSql()<{ workspaces: string; operators: string }[]>`
    select
      (select count(*)::text from platform.tenants where status = 'active') as workspaces,
      (select count(*)::text from platform.platform_operators where active = true) as operators`) as unknown as {
    workspaces: string;
    operators: string;
  }[];
  const badge = counts[0] ?? { workspaces: "0", operators: "0" };

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="bg-night text-white lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="text-turmeric">
            <ConsoleMark />
          </span>
          <div className="leading-tight">
            <div className="font-display text-[17px] font-semibold tracking-tight">Platform</div>
            <div className="text-[11px] text-night-3">{PRODUCT_NAME}</div>
          </div>
        </div>
        <ConsoleNav workspaces={Number(badge.workspaces)} operators={Number(badge.operators)} />
        <div className="hidden items-center justify-between gap-2 border-t border-white/10 px-5 py-4 text-xs text-night-3 lg:flex">
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{operator.name}</div>
            <div className="capitalize">{operator.role}</div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-card/70 px-4 py-2.5 backdrop-blur sm:px-8">
          <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/super-admin" className="hover:text-ink">
                  Console
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
          <OperatorMenu email={operator.email} role={operator.role} hasPassword={operator.hasPassword} />
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
