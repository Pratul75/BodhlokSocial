"use server";

import { revalidatePath } from "next/cache";
import { canAccess } from "@bodh/shared";
import { requestChange, syncAdStructure, type ChangeRequest } from "@bodh/integrations/ads";
import { getCurrentUser } from "@/lib/auth";
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
