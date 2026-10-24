import Link from "next/link";
import { KundliMark } from "@/components/kundli-mark";
import { authEnabled, safeReturnTo } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  no_access: "Your account hasn't been added yet. Ask an admin to add you in Admin, then sign in again.",
  domain: "Sign in with your company Google account. Personal Gmail accounts can't sign in.",
  unverified: "Google hasn't verified this email address. Use your company account.",
  expired: "The sign-in took too long. Try again.",
  cancelled: "Sign-in was cancelled.",
  google: "Google didn't complete the sign-in. Try again.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; signed_out?: string }> }) {
  const sp = await searchParams;
  const enabled = authEnabled();
  const next = safeReturnTo(sp.next);
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? "rechargestudio.com").split(",").map((d) => d.trim());

  return (
    <main className="flex min-h-dvh items-center justify-center bg-night px-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
        <div className="flex items-center gap-2.5 text-ink">
          <span className="text-turmeric"><KundliMark className="h-8 w-8" /></span>
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold tracking-tight">BODH Growth</div>
            <div className="text-xs text-muted">Asttrolok marketing</div>
          </div>
        </div>

        <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use your {domains.map((d) => `@${d}`).join(" or ")} Google account.</p>

        {sp.error && ERRORS[sp.error] && (
          <p className="mt-4 rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor" role="alert">{ERRORS[sp.error]}</p>
        )}
        {sp.signed_out && !sp.error && (
          <p className="mt-4 rounded-lg bg-leaf-soft px-3 py-2 text-sm text-leaf" role="status">You're signed out.</p>
        )}

        {enabled ? (
          <a
            href={`/api/auth/google?next=${encodeURIComponent(next)}`}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-lg border border-rule bg-card px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
            </svg>
            Sign in with Google
          </a>
        ) : (
          <div className="mt-6 rounded-lg bg-turmeric-soft px-3 py-3 text-sm text-turmeric-ink">
            Google sign-in isn't configured, so the app runs as the dev user.{" "}
            <Link href="/" className="font-medium underline">Open the app</Link>
          </div>
        )}
      </div>
    </main>
  );
}
