"use server";

import { revalidatePath } from "next/cache";
import { canAccess } from "@bodh/shared";
import { requestChange, retryChange, syncAdStructure, type ChangeRequest } from "@bodh/integrations/ads";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { JobState } from "@/app/(app)/seo/actions";

export async function syncAdsAction(_prev: JobState, _formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "ads")) return { error: "Your role can't manage ads." };
  try {
    const message = await syncAdStructure();
    revalidatePath("/ads");
    return { message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** A person pausing an ad from the table goes through the same guardrails as the agent. */
export async function pauseAdAction(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "ads")) return { error: "Your role can't manage ads." };
  const platform = String(formData.get("platform"));
  if (platform !== "meta_ads" && platform !== "google_ads") return { error: "Unknown platform." };
  const req: ChangeRequest = { type: "pause_ad", platform, adId: String(formData.get("adId")) };
  const r = await requestChange(req, `Paused from the Ads manager by ${user.name}.`, { name: user.email, kind: "user" });
  revalidatePath("/ads");
  return r.outcome === "blocked" || r.outcome === "failed" ? { error: r.message } : { message: r.message };
}

/** Tries a change the platform refused again, after checking the caps as they stand now. */
export async function retryChangeAction(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "ads")) return { error: "Your role can't manage ads." };
  const id = String(formData.get("changeId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown change." };
  const r = await retryChange(id);
  await audit({ actor: user.email, actorType: "user", action: "retry_ad_change", target: id, result: r.ok ? "applied" : r.error });
  revalidatePath("/ads");
  return r.ok ? { message: "Applied." } : { error: r.error };
}
