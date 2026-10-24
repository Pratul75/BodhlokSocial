"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { calendarItems, db, publishingChannels } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { runJob } from "@bodh/integrations/pipeline";
import { listIntegrations, channelFor } from "@bodh/integrations/postiz";
import { postizCredentials, runPublisher } from "@bodh/integrations/publisher";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type PubResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function retryPublish(formData: FormData) {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "publishing")) return;
  const id = String(formData.get("id"));
  const [item] = await db.select().from(calendarItems).where(eq(calendarItems.id, id)).limit(1);
  if (!item || item.status !== "failed") return;
  // Back to approved: the publisher re-checks the approval and the post rules before sending.
  const soon = new Date(Date.now() + 10 * 60 * 1000);
  await db
    .update(calendarItems)
    .set({ status: "approved", error: null, publishAttempts: 0, scheduledAt: item.scheduledAt < soon ? soon : item.scheduledAt })
    .where(and(eq(calendarItems.id, id), eq(calendarItems.status, "failed")));
  await audit({ actor: user.email, actorType: "user", action: "retry_publish", target: item.idea, result: "queued for the publisher" });
  revalidatePath("/publishing");
  revalidatePath(`/calendar/${id}`);
}

export async function mapChannel(_prev: PubResult, formData: FormData): Promise<PubResult> {
  const user = await getCurrentUser();
  if (user.role !== "admin") return { ok: false, error: "Only admins can choose publishing channels." };
  const channel = String(formData.get("channel"));
  const integrationId = String(formData.get("integrationId") ?? "");
  if (!integrationId) {
    await db.delete(publishingChannels).where(eq(publishingChannels.channel, channel));
    revalidatePath("/publishing");
    return { ok: true, message: "Cleared." };
  }
  const creds = await postizCredentials();
  if (!creds) return { ok: false, error: "Connect Postiz first." };
  try {
    const found = (await listIntegrations(creds)).find((i) => i.id === integrationId);
    if (!found) return { ok: false, error: "That Postiz channel no longer exists." };
    if (channelFor(found.identifier) !== channel) return { ok: false, error: `${found.name} is a ${found.identifier} channel, not ${channel}.` };
    await db
      .insert(publishingChannels)
      .values({ channel, postizIntegrationId: found.id, postizIdentifier: found.identifier, name: found.name, picture: found.picture ?? null, updatedBy: user.email })
      .onConflictDoUpdate({
        target: publishingChannels.channel,
        set: { postizIntegrationId: found.id, postizIdentifier: found.identifier, name: found.name, picture: found.picture ?? null, updatedBy: user.email, updatedAt: new Date() },
      });
    await audit({ actor: user.email, actorType: "user", action: "map_publishing_channel", target: channel, result: `${found.name} (${found.identifier})` });
    revalidatePath("/publishing");
    return { ok: true, message: `${channel} posts go to ${found.name}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Postiz." };
  }
}

export async function runPublisherNow(_prev: PubResult, _formData: FormData): Promise<PubResult> {
  const user = await getCurrentUser();
  if (user.role !== "admin") return { ok: false, error: "Only admins can run the publisher." };
  try {
    const r = await runJob("publisher", () => runPublisher());
    revalidatePath("/publishing");
    revalidatePath("/calendar");
    return { ok: true, message: r.detail };
  } catch (e) {
    revalidatePath("/publishing");
    return { ok: false, error: e instanceof Error ? e.message : "The publisher failed." };
  }
}
