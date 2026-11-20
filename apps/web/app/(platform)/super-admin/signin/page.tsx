import { redirect } from "next/navigation";
import { LOCKOUT_AFTER, LOCKOUT_MINUTES } from "@/lib/passwords";
import { currentOperator, operatorFormSignInAllowed } from "@/lib/platform-auth";
import { PRODUCT_NAME } from "@/lib/legal";
import { ConsoleMark } from "../mark";
import { SignInForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform console" };

export default async function PlatformSignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; set?: string }>;
}) {
  if (await currentOperator()) redirect("/super-admin");
  const { next, set } = await searchParams;
  const devHint = operatorFormSignInAllowed();

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
          <h1 className="font-display text-xl font-semibold">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted">
            For the people who run the platform. A workspace sign-in does not work here.
          </p>

          {set && (
            <p className="mt-4 rounded-lg bg-leaf-soft px-3 py-2 text-sm text-leaf">
              Password set. Sign in with it.
            </p>
          )}

          <SignInForm next={next ?? "/super-admin"} devHint={devHint} />

          <p className="mt-5 border-t border-rule pt-4 text-xs text-muted">
            Forgotten your password? An owner issues a one-time link from{" "}
            <span className="font-medium">Operators</span> in the console — there is no mail service
            here, so nothing is sent by email.
          </p>
          <p className="mt-2 text-xs text-muted">
            {LOCKOUT_AFTER} wrong passwords stop an account answering for {LOCKOUT_MINUTES} minutes.
            Until then every attempt is refused, the right password included.
          </p>
          {devHint && (
            <p className="mt-2 text-xs text-muted">
              Development: an operator who has no password yet can sign in with their address alone.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
