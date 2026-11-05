import Link from "next/link";
import type { ReactNode } from "react";
import { COMPANY_NAME, CONTACT_EMAIL, PRODUCT_NAME } from "@/lib/legal";

/** Shell for the pages anyone can open without signing in: home, privacy policy and terms. */
export function PublicPage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-night">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/about" className="font-display text-lg font-semibold tracking-tight text-white">
            {PRODUCT_NAME}
          </Link>
          <nav className="flex gap-4 text-sm text-night-3">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <Link href="/signin" className="hover:text-white">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {updated && <p className="mt-2 text-sm text-muted">Last updated {updated}</p>}
        <div className="legal mt-8 space-y-4 text-[15px] leading-relaxed text-ink [&_a]:text-dusk [&_a]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-2">
          {children}
        </div>
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
          <span>
            {PRODUCT_NAME} is made by {COMPANY_NAME}.
          </span>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink">{CONTACT_EMAIL}</a>
          <Link href="/privacy" className="hover:text-ink">Privacy policy</Link>
          <Link href="/terms" className="hover:text-ink">Terms of service</Link>
        </div>
      </footer>
    </div>
  );
}
