"use client";

import { useEffect } from "react";
import { btn } from "@/components/ui";

/** A module page failed to load (the database or a connected service didn't answer). */
export default function ModuleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("page error", error.digest ?? "", error.message);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-xl border border-sindoor/30 bg-card px-6 py-8 text-center">
      <h1 className="font-display text-lg font-semibold">This page couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted">
        Something it needs didn&apos;t answer, usually the database or a connected account. Nothing was changed. Try again; if it keeps happening, tell an admin
        {error.digest ? <> and quote <code className="font-mono text-xs">{error.digest}</code></> : null}.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button className={btn.primary} onClick={() => reset()}>Try again</button>
        <a href="/" className={btn.secondary}>Go to Today</a>
      </div>
    </div>
  );
}
