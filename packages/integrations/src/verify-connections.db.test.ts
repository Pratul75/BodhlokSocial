/**
 * The daily credential re-check against a real Postgres database.
 * Creates and drops its own database; skipped when Postgres isn't reachable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_verifytest_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

const checkCms = vi.fn(async () => "Signed in to the CMS as growth@bodhlok.com · Bodhlok.");
vi.mock("./site-publisher", () => ({ checkCmsConnection: () => checkCms() }));

describe.skipIf(!reachable)("verifyConnections", () => {
  let dir: string;
  let m: { db: typeof import("@bodh/db"); verify: typeof import("./verify-connections"); secrets: typeof import("./secrets"); orm: typeof import("drizzle-orm") };

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = base.replace(/\/[^/]+$/, `/${dbName}`);
    process.env.DATABASE_URL = url;
    dir = await mkdtemp(join(tmpdir(), "bodh-verify-"));
    process.env.SECRETS_DIR = join(dir, "secrets");
    delete process.env.SECRETS_BACKEND;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const mc = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(mc), { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
    await mc.end();
    m = { db: await import("@bodh/db"), verify: await import("./verify-connections"), secrets: await import("./secrets"), orm: await import("drizzle-orm") };
  });

  afterAll(async () => {
    await m?.db.sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  });

  it("leaves connections it has no check for as they are, and checks the CMS with its own sign-in", async () => {
    const { connections } = m.db;
    const store = await m.secrets.secretStore();
    for (const key of ["crm_billing", "bodhlok_cms"]) await store.put(m.secrets.secretName(key), JSON.stringify({ api_key: "x" }));
    await m.db.db
      .insert(connections)
      .values([
        { key: "crm_billing", status: "error", error: "Signature mismatch on the last delivery", secretRef: "crm_billing" },
        { key: "bodhlok_cms", status: "error", error: "The bodhlok.com sign-in has run out.", secretRef: "bodhlok_cms" },
      ])
      .onConflictDoUpdate({ target: connections.key, set: { status: m.orm.sql`excluded.status`, error: m.orm.sql`excluded.error`, secretRef: m.orm.sql`excluded.secret_ref` } });

    const checks = await m.verify.verifyConnections();

    const [crm] = await m.db.db.select().from(connections).where(m.orm.eq(connections.key, "crm_billing"));
    expect(crm).toMatchObject({ status: "error", error: "Signature mismatch on the last delivery" });
    expect(checks.find((c) => c.key === "crm_billing")).toBeUndefined();
    expect(checkCms).toHaveBeenCalledOnce();
    expect(checks.find((c) => c.key === "bodhlok_cms")).toMatchObject({ ok: true });

    checkCms.mockRejectedValueOnce(new Error("The bodhlok.com sign-in has run out."));
    const again = await m.verify.verifyConnections();
    expect(again.find((c) => c.key === "bodhlok_cms")).toMatchObject({ ok: false, detail: "The bodhlok.com sign-in has run out." });
  });
});
