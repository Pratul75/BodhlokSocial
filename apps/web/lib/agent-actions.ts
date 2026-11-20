"use server";

import { revalidatePath } from "next/cache";
import { isAgentName } from "@bodh/agents";
import { AGENT_FEATURE, AGENT_MODULE } from "@bodh/shared";
import { allowed, enterTenantScope, featureOn, getCurrentUser } from "./auth";
import { startAgentRun } from "./agents";

export interface RunState {
  error?: string;
  started?: boolean;
}

const PAGE_FOR = { strategy: "/strategy", content: "/calendar", seo: "/seo", ads: "/ads", community: "/community", mentions: "/seo/listings", analyst: "/analytics" } as const;

export async function runAgentAction(_prev: RunState, formData: FormData): Promise<RunState> {
  const user = enterTenantScope(await getCurrentUser());
  const agent = String(formData.get("agent"));
  if (!isAgentName(agent) || !allowed(user, AGENT_MODULE[agent])) return { error: "You can't run this agent." };
  // The workspace's own switch, read from the entitlements already on the user.
  if (!featureOn(user, AGENT_FEATURE[agent]!)) return { error: "That agent isn't switched on for this workspace." };
  const task = String(formData.get("task") ?? "").trim() || undefined;
  const res = await startAgentRun(agent, user.email, task);
  if (res.error) return { error: res.error };
  revalidatePath(PAGE_FOR[agent]);
  return { started: true };
}
