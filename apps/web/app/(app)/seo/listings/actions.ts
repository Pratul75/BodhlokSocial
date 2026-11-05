"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, directoryListings } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { JobState } from "@/app/(app)/seo/actions";

const Submitted = z.object({
  id: z.uuid(),
  url: z.url().refine((u) => /^https?:\/\//.test(u), "Paste the link to the live listing."),
});

/** A person submitted an approved listing by hand and records where it lives. */
export async function markSubmitted(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return { error: "Your role can't manage directory listings." };
  const p = Submitted.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Paste the link to the listing." };
  const r = await db
    .update(directoryListings)
    .set({ status: "submitted", submittedUrl: p.data.url, submittedBy: user.email, submittedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(directoryListings.id, p.data.id), eq(directoryListings.status, "approved")))
    .returning({ name: directoryListings.name });
  if (!r.length) return { error: "Only an approved listing can be marked submitted." };
  await audit({ actor: user.email, actorType: "user", action: "submit_listing", target: r[0]!.name, result: p.data.url });
  revalidatePath("/seo/listings");
  return { message: "Marked as submitted." };
}

export async function skipListing(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return { error: "Your role can't manage directory listings." };
  const p = z.object({ id: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Unknown listing." };
  const r = await db
    .update(directoryListings)
    .set({ status: "skipped", reviewNote: `Skipped by ${user.name}`, updatedAt: new Date() })
    .where(and(eq(directoryListings.id, p.data.id), inArray(directoryListings.status, ["found", "drafted", "approved"])))
    .returning({ name: directoryListings.name });
  if (!r.length) return { error: "This listing can't be skipped now." };
  await audit({ actor: user.email, actorType: "user", action: "skip_listing", target: r[0]!.name, result: "skipped" });
  revalidatePath("/seo/listings");
  return { message: "Skipped." };
}
