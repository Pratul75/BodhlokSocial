"use client";

import type { ReactNode } from "react";

/** A form that asks before it submits, for actions that can't be undone in one click. */
export function ConfirmForm({ action, message, children, className }: { action: (formData: FormData) => void | Promise<void>; message: string; children: ReactNode; className?: string }) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
