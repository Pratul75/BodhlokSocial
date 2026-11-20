import { ownerSql } from "@bodh/db";

export const dynamic = "force-dynamic";

/**
 * Cloud Run startup and liveness probe.
 *
 * It asks the control plane, not a tenant: a health check belongs to no tenant, and once the
 * single-tenant fallback is gone a query with no tenant context is refused by design.
 */
export async function GET() {
  try {
    await ownerSql()`select 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
