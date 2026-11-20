import Link from "next/link";
import { KundliMark } from "@/components/kundli-mark";
import { authEnabled, devAuthAllowed, safeReturnTo } from "@/lib/session";
import { allowedDomains } from "@/lib/google";
import { tenantFromRequest } from "@/lib/tenant";
import { choicesFromToken } from "@/lib/workspace-choice";
import { PasswordSignInForm, WorkspacePicker } from "./forms";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  no_access: "Your account hasn't been added yet. Ask an admin to add you in Admin, then sign in again.",
  domain: "A company address has to sign in with the company's Google account, not a personal account made with that address.",
  unverified: "Google hasn't verified this email address. Use the Google account for the address an admin added.",
  expired: "The sign-in took too long. Try again.",
  session_ended: "You were signed out, on this device or another one. Sign in again.",
  cancelled: "Sign-in was cancelled.",
  google: "Google didn't complete the sign-in. Try again.",
  wrong_tenant: "That page belongs to a different workspace than the one you're signed in to. Sign in to that workspace instead.",
  tenant_suspended: "This workspace is suspended. Ask your admin, or the people who run the platform.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; signed_out?: string; set?: string; choose?: string }>;
}) {
  const sp = await searchParams;
  const enabled = authEnabled();
  const next = safeReturnTo(sp.next);
  // A Google sign-in that opened more than one workspace comes back here to ask which. The
  // token is the proof; an expired or tampered one leaves an empty list and the page simply
  // shows the ordinary doors again.
  const choices = sp.choose ? await choicesFromToken(sp.choose) : [];
  // The workspace this address belongs to decides whose domains these are; with no workspace in
  // the address it falls back to the server's own, which is the single-tenant case.
  const domains = await allowedDomains().catch(() => ["example.com"]);
  // Whose sign-in page this is. At a workspace's own address it says so, which is the only way
  // somebody can tell they are signing in to theirs and not to somebody else's.
  const { tenant } = await tenantFromRequest().catch(() => ({ tenant: null }));

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-night px-4 pb-16">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-xl">
        <div className="flex items-center gap-2.5 text-ink">
          <span className="text-turmeric"><KundliMark className="h-8 w-8" /></span>
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold tracking-tight">BODH Growth</div>
            <div className="text-xs text-muted">{tenant?.name ?? "Bodhlok marketing"}</div>
          </div>
        </div>

        <h1 className="mt-8 font-display text-2xl font-semibold tracking-tight">
          {choices.length ? "Which workspace?" : "Sign in"}
        </h1>
        {choices.length === 0 && (
          <p className="mt-1 text-sm text-muted">
            {enabled
              ? `Use your ${domains.map((d) => `@${d}`).join(" or ")} Google account, or the email and password an admin set up for you.`
              : "Use the email and password an admin set up for you."}
          </p>
        )}

        {sp.error && ERRORS[sp.error] && (
          <p className="mt-4 rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor" role="alert">{ERRORS[sp.error]}</p>
        )}
        {sp.signed_out && !sp.error && (
          <p className="mt-4 rounded-lg bg-leaf-soft px-3 py-2 text-sm text-leaf" role="status">You're signed out.</p>
        )}
        {sp.set && !sp.error && (
          <p className="mt-4 rounded-lg bg-leaf-soft px-3 py-2 text-sm text-leaf" role="status">
            Password set. Sign in with it.
          </p>
        )}

        {choices.length ? (
          <div className="mt-6">
            <WorkspacePicker choices={choices} token={sp.choose!} next={next} />
          </div>
        ) : (
          <>
        {/* The password door. Always here: it belongs to the workspace, not to Google. */}
        <div className="mt-6">
          <PasswordSignInForm next={next} />
        </div>

        {enabled && (
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-rule" />
            or
            <span className="h-px flex-1 bg-rule" />
          </div>
        )}

        {enabled ? (
          <a
            href={`/api/auth/google?next=${encodeURIComponent(next)}`}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-rule bg-card px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
            </svg>
            Sign in with Google
          </a>
        ) : devAuthAllowed() ? (
          <div className="mt-5 rounded-lg bg-turmeric-soft px-3 py-3 text-sm text-turmeric-ink">
            Google sign-in isn't configured here, so the app also runs as the dev user.{" "}
            <Link href="/" className="font-medium underline">Open the app</Link>
          </div>
        ) : null}
          </>
        )}
      </div>
      <nav className="absolute bottom-6 flex gap-5 text-xs text-night-3">
        <Link href="/about" className="hover:text-white">About</Link>
        <Link href="/privacy" className="hover:text-white">Privacy policy</Link>
        <Link href="/terms" className="hover:text-white">Terms of service</Link>
      </nav>
    </main>
  );
}
