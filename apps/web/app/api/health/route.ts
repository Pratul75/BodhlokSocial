import { sql } from "drizzle-orm";
import { db } from "@bodh/db";

export const dynamic = "force-dynamic";

/** Cloud Run startup and liveness probe. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
