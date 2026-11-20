import Link from "next/link";
import { operatorForResetToken } from "@/lib/platform-auth";
import { PRODUCT_NAME } from "@/lib/legal";
import { ConsoleMark } from "../mark";
import { SetPasswordForm } from "../signin/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password" };

/** Where a one-time link lands. Open to anyone holding the link, and to nobody else. */
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const target = token ? await operatorForResetToken(token) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-night px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 text-white">
          <span className="text-turmeric">
            <ConsoleMark />
          </span>
          <div className="leading-tight">
            <div className="font-display text-[17px] font-semibold tracking-tight">Platform console</div>
            <div className="text-[11px] text-night-3">{PRODUCT_NAME}</div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-rule bg-card p-6 shadow-sm">
          <h1 className="font-display text-xl font-semibold">Set your password</h1>
          {target ? (
            <SetPasswordForm token={token!} name={target.email} />
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                This link has been used already, or it has expired. Ask an owner for a new one.
              </p>
              <Link href="/super-admin/signin" className="mt-5 inline-block text-sm text-dusk hover:underline">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
