"use server";

import { revalidatePath } from "next/cache";
import { isAgentName } from "@bodh/agents";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "./auth";
import { startAgentRun } from "./agents";

export interface RunState {
  error?: string;
  started?: boolean;
}

const MODULE_FOR = { strategy: "strategy", content: "calendar", seo: "seo", ads: "ads" } as const;
const PAGE_FOR = { strategy: "/strategy", content: "/calendar", seo: "/seo", ads: "/ads" } as const;

export async function runAgentAction(_prev: RunState, formData: FormData): Promise<RunState> {
  const user = await getCurrentUser();
  const agent = String(formData.get("agent"));
  if (!isAgentName(agent) || !canAccess(user.role, MODULE_FOR[agent])) return { error: "You can't run this agent." };
  const task = String(formData.get("task") ?? "").trim() || undefined;
  const res = await startAgentRun(agent, user.email, task);
  if (res.error) return { error: res.error };
  revalidatePath(PAGE_FOR[agent]);
  return { started: true };
}
