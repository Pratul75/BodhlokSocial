"use client";

import { useEffect, useState } from "react";

const COOKIE = "bodh_workspace";

function currentWorkspace(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Notices when this tab is showing a workspace the session has since left.
 *
 * One session cookie means one workspace at a time. Switch in another tab and this one keeps
 * showing what it rendered — the right pictures, the wrong workspace. Press a button here and
 * the action would run over there: the screen says Client ABC and the post lands in Client XYZ.
 * That is a data mix. Not in the database, which is as separated as ever, but between what
 * somebody is looking at and what they are acting on, which is just as wrong for them.
 *
 * So the page carries the workspace it was rendered for, and compares it against the marker the
 * browser holds — on mount, whenever the tab is looked at again, and whenever the window
 * regains focus, which is exactly when somebody comes back to a tab they left. When they
 * disagree, the page is covered: there is nothing to press until it is reloaded.
 *
 * A guard of this shape used to exist and was lost. While the workspace was in the address, the
 * address and the cookie were compared on every request and a mismatch was refused. Taking the
 * name out of the address left that comparison with nothing to compare. This replaces it.
 */
export function WorkspaceGuard({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const check = () => {
      const now = currentWorkspace();
      // No marker at all is not a mismatch: an older session predates it, and the page is still
      // being served for the workspace its own session names.
      setStale(Boolean(now) && now !== tenantId);
    };
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    // And on a timer as well. The events above are the ones that matter — they fire the moment
    // somebody comes back to the tab — but not every browser and embedded view delivers them,
    // and a guard that depends on being told is a guard that can be silently absent. Reading
    // one cookie every few seconds costs nothing and makes it answer for itself.
    const tick = setInterval(check, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      clearInterval(tick);
    };
  }, [tenantId]);

  if (!stale) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true">
      <div className="max-w-md rounded-xl bg-card p-6 shadow-xl">
        <h2 className="font-display text-lg font-semibold tracking-tight">You moved to another workspace</h2>
        <p className="mt-2 text-sm text-muted">
          This tab is still showing <strong className="text-ink">{tenantName}</strong>, but you switched workspace
          somewhere else. Anything you do here would happen in the workspace you switched to, so nothing on this page
          can be used until it is reloaded.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2"
        >
          Reload this page
        </button>
      </div>
    </div>
  );
}
