import "server-only";
import { auditLog, db } from "@bodh/db";

export async function audit(entry: {
  actor: string;
  actorType: "user" | "agent";
  action: string;
  target: string;
  reason?: string | null;
  result: string;
}) {
  await db.insert(auditLog).values({ ...entry, reason: entry.reason ?? null });
}
