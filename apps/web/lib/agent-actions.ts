"use server";

import { revalidatePath } from "next/cache";
import { isAgentName } from "@bodh/agents";
import { AGENT_MODULE, canAccess } from "@bodh/shared";
import { getCurrentUser } from "./auth";
import { startAgentRun } from "./agents";

export interface RunState {
  error?: string;
  started?: boolean;
}

const PAGE_FOR = { strategy: "/strategy", content: "/calendar", seo: "/seo", ads: "/ads", community: "/community", mentions: "/seo/listings", analyst: "/analytics" } as const;

export async function runAgentAction(_prev: RunState, formData: FormData): Promise<RunState> {
  const user = await getCurrentUser();
  const agent = String(formData.get("agent"));
  if (!isAgentName(agent) || !canAccess(user.role, AGENT_MODULE[agent])) return { error: "You can't run this agent." };
  const task = String(formData.get("task") ?? "").trim() || undefined;
  const res = await startAgentRun(agent, user.email, task);
  if (res.error) return { error: res.error };
  revalidatePath(PAGE_FOR[agent]);
  return { started: true };
}
