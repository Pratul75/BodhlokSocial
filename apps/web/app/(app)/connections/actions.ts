"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { getIntegration } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { secretName, secretStore } from "@/lib/secrets";
import { revokeGrant, syncIntegration } from "@/lib/integrations/google-connection";

export type ConnResult = { ok: true; message: string } | { ok: false; error: string } | null;

async function requireAdmin() {
  const user = await getCurrentUser();
  if (user.role !== "admin") throw new Error("Only admins can change connections.");
  return user;
}

export async function saveKey(_prev: ConnResult, formData: FormData): Promise<ConnResult> {
  try {
    const user = await requireAdmin();
    const key = String(formData.get("key"));
    const label = String(formData.get("label") ?? "").trim() || null;
    const def = getIntegration(key);
    if (!def || (def.method !== "api_key" && def.method !== "service_account")) {
      return { ok: false, error: "This integration doesn't take a pasted key." };
    }
    let value = String(formData.get("value") ?? "").trim();
    if (def.fields) {
      const parts: Record<string, string> = {};
      for (const f of def.fields) {
        const v = String(formData.get(`field_${f.name}`) ?? "").trim();
        if (!v && !f.optional) return { ok: false, error: `Fill in ${f.label}.` };
        if (v) parts[f.name] = v;
      }
      value = JSON.stringify(parts);
    } else if (value.length < 8) {
      return { ok: false, error: "That key looks too short. Paste the full value." };
    }
    if (def.method === "service_account") {
      try {
        const parsed = JSON.parse(value);
        if (!parsed.client_email || !parsed.private_key) throw new Error();
      } catch {
        return { ok: false, error: "Paste the full service account JSON file, including client_email and private_key." };
      }
    }

    const ref = await (await secretStore()).put(secretName(key), value);
    await db
      .update(connections)
      .set({ status: "connected", secretRef: ref, accountLabel: label, error: null, updatedAt: new Date() })
      .where(eq(connections.key, key));
    await audit({ actor: user.email, actorType: "user", action: "connect", target: def.name, result: "connected" });
    revalidatePath("/connections");
    return { ok: true, message: `${def.name} connected.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the key." };
  }
}

export async function disconnect(formData: FormData) {
  const user = await requireAdmin();
  const key = String(formData.get("key"));
  const def = getIntegration(key);
  if (!def) return;
  if (def.googleOAuth) await revokeGrant(key);
  await (await secretStore()).remove(secretName(key));
  await db
    .update(connections)
    .set({ status: "not_connected", secretRef: null, accountLabel: null, lastSyncAt: null, error: null, updatedAt: new Date() })
    .where(eq(connections.key, key));
  await audit({ actor: user.email, actorType: "user", action: "disconnect", target: def.name, result: "disconnected" });
  revalidatePath("/connections");
}

export async function syncNow(_prev: ConnResult, formData: FormData): Promise<ConnResult> {
  try {
    const user = await requireAdmin();
    const key = String(formData.get("key"));
    const def = getIntegration(key);
    if (!def) return { ok: false, error: "Unknown integration." };
    const { message } = await syncIntegration(key);
    await audit({ actor: user.email, actorType: "user", action: "sync", target: def.name, result: message });
    revalidatePath("/connections");
    revalidatePath("/seo");
    return { ok: true, message };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Sync failed.";
    const key = String(formData.get("key"));
    await db.update(connections).set({ status: "error", error, updatedAt: new Date() }).where(eq(connections.key, key));
    revalidatePath("/connections");
    return { ok: false, error };
  }
}
