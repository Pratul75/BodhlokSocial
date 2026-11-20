import type { ReactNode } from "react";

/** The Super Admin console. A separate shell from the tenant app, on its own session. */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-canvas">{children}</div>;
}
