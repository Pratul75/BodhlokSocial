import Link from "next/link";
import { KundliMark } from "@/components/kundli-mark";
import { tenantFromRequest } from "@/lib/tenant";
import { resolveTenant } from "@bodh/db";
import { tenantForInviteToken, userForInviteToken } from "@/lib/user-passwords";
import { SetPasswordForm } from "../signin/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password" };

/**
 * Where an invitation or a reset link lands.
 *
 * Open to whoever holds the link and to nobody else — there is no session here yet, which is
 * the whole point. The workspace comes from the address, never from the link, so a token can
 * only ever be spent against the workspace it was made in.
 */
export default async function SetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const { named, tenant: fromAddress } = await tenantFromRequest();
  // An address that names a workspace must resolve to that workspace. Otherwise the link itself
  // says which one it was made in — that is why this page can live at the bare address, with no
  // workspace in the URL at all. Falling back to the default covers a single-tenant install.
  const tenant = named
    ? fromAddress
    : ((token ? await tenantForInviteToken(token) : null) ?? (await resolveTenant(null)));
  const target = tenant && tenant.status === "active" && token ? await userForInviteToken(tenant, token) : null;
  const signIn = named ? `/t/${named}/signin` : "/signin";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-night px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 text-white">
          <span className="text-turmeric"><KundliMark className="h-8 w-8" /></span>
          <div className="leading-tight">
            <div className="font-display text-[17px] font-semibold tracking-tight">BODH Growth</div>
            <div className="text-[11px] text-night-3">{tenant?.name ?? "Bodhlok marketing"}</div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-rule bg-card p-6 shadow-sm">
          <h1 className="font-display text-xl font-semibold">
            {target?.isReset ? "Choose a new password" : "Set your password"}
          </h1>
          {target?.mustChange && (
            <p className="mt-2 text-sm text-muted">
              The password you signed in with was a temporary one. Choose your own to carry on — it
              is the only thing that will work after this.
            </p>
          )}
          {target ? (
            <SetPasswordForm token={token!} name={target.email} isReset={target.isReset} />
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                This link has been used already, or it has expired. Ask your workspace admin for a new one.
              </p>
              <Link href={signIn} className="mt-5 inline-block text-sm text-dusk hover:underline">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
