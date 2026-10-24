"use server";

import { revalidatePath } from "next/cache";
import { forwardToGoogle, forwardToMeta, istDate, rebuild, runJob } from "@bodh/integrations/pipeline";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type RunResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function runTrackingJob(_prev: RunResult, formData: FormData): Promise<RunResult> {
  const user = await getCurrentUser();
  if (user.role !== "admin") return { ok: false, error: "Only admins can run tracking jobs." };
  const job = String(formData.get("job"));
  try {
    let message: string;
    if (job === "rebuild") {
      message = (await runJob("rebuild_funnel", () => rebuild(istDate(new Date(), -35), istDate()))).detail;
    } else if (job === "forward") {
      const meta = await runJob("forward_meta", forwardToMeta);
      const google = await runJob("forward_google", forwardToGoogle);
      message = `${meta.detail} ${google.detail}`;
    } else {
      return { ok: false, error: "Unknown job." };
    }
    await audit({ actor: user.email, actorType: "user", action: `run_${job}`, target: "tracking", result: message });
    revalidatePath("/tracking");
    revalidatePath("/analytics");
    revalidatePath("/");
    return { ok: true, message };
  } catch (e) {
    revalidatePath("/tracking");
    return { ok: false, error: e instanceof Error ? e.message : "The job failed." };
  }
}
