"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

const field =
  "rounded-lg border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-dusk focus:outline-none";

/**
 * Search, filter and sort, kept in the address bar rather than in component state: a filtered
 * list is then a link an operator can keep or send, and the back button does what it should.
 */
export function WorkspaceFilters({ q, status, sort }: { q: string; status: string; sort: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(q);

  useEffect(() => setText(q), [q]);

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== "all" && !(k === "sort" && v === "name")) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`/super-admin/workspaces${p.toString() ? `?${p}` : ""}`);
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: text, status, sort });
      }}
    >
      <label className="relative min-w-[220px] flex-1 text-sm">
        <span className="sr-only">Search workspaces</span>
        <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name, address or schema"
          className={`${field} w-full pl-9`}
        />
      </label>
      <label className="text-sm">
        <span className="sr-only">Status</span>
        <select value={status} onChange={(e) => go({ q: text, status: e.target.value, sort })} className={field}>
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="provisioning">Provisioning</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="sr-only">Sort by</span>
        <select value={sort} onChange={(e) => go({ q: text, status, sort: e.target.value })} className={field}>
          <option value="name">By name</option>
          <option value="people">Most people</option>
          <option value="spend">Most AI spend</option>
          <option value="activity">Most recent activity</option>
        </select>
      </label>
      <button className="rounded-lg border border-rule bg-card px-3 py-2 text-sm font-medium hover:bg-paper">Search</button>
    </form>
  );
}
