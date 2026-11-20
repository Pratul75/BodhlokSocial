/**
 * Attaching a freshly made creative to the post it was made for, against a real Postgres.
 *
 * This is the one step in that path that changes a post somebody else may be waiting on, so the
 * things worth proving are what it must never do: lose media that was already there, attach the
 * same file twice, or leave a post sitting in the approval queue with different pictures in it
 * than the approver agreed to.
 *
 * Creates and drops its own database, so it never touches development data; skipped when
 * Postgres isn't reachable.
 */
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_attach_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("attaching a creative to a post", () => {
  let mod: typeof import("@bodh/db");
  let attach: typeof import("./attach-creative");
  let tenant: import("@bodh/db").TenantRef;
  const assetIds: string[] = [];

  /** A post with the given status and media, returning its id. */
  async function post(status: string, media: string[] = []) {
    return mod.withTenant(tenant, async () => {
      const [row] = await mod.db
        .insert(mod.calendarItems)
        .values({
          channel: "instagram",
          format: "image",
          idea: `Post ${status}`,
          status,
          assetIds: media,
          scheduledAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: mod.calendarItems.id });
      return row!.id;
    });
  }

  const read = (id: string) =>
    mod.withTenant(tenant, async () => {
      const [row] = await mod.db.select().from(mod.calendarItems).where(eq(mod.calendarItems.id, id)).limit(1);
      return row!;
    });

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    delete process.env.DEFAULT_TENANT_SLUG;

    mod = await import("@bodh/db");
    await mod.setupPlatform();
    const bootstrap = await mod.migrateTenant(
      { id: "bootstrap", slug: "one", name: "One", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    expect(bootstrap.error).toBeUndefined();
    tenant = await mod.registerFirstTenant({ slug: "one", name: "One" });

    // Three real asset rows, so what is attached is something that exists.
    await mod.withTenant(tenant, async () => {
      for (const name of ["a.png", "b.png", "c.png"]) {
        const [a] = await mod.db
          .insert(mod.assets)
          .values({ name, type: "image", source: "gemini", storagePath: `generated/${name}`, contentType: "image/png", sizeBytes: 10, createdBy: "test" })
          .returning({ id: mod.assets.id });
        assetIds.push(a!.id);
      }
    });

    attach = await import("./attach-creative");
  }, 180_000);

  afterAll(async () => {
    const role = tenant?.dbRole;
    await mod?.sql?.end?.({ timeout: 5 }).catch(() => undefined);
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    if (role) {
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}"`).catch(() => undefined);
      await admin.unsafe(`drop role if exists "${`${role}_ro`.replace(/"/g, '""')}"`).catch(() => undefined);
    }
    await admin.end();
  }, 60_000);

  it("adds the new media after what was already there, in order", async () => {
    const id = await post("drafted", [assetIds[0]!]);
    const out = await mod.withTenant(tenant, () => attach.attachCreativeToPost(id, [assetIds[1]!, assetIds[2]!], "me@test"));
    expect(out.attached).toBe(2);
    expect((await read(id)).assetIds).toEqual([assetIds[0], assetIds[1], assetIds[2]]);
  });

  it("never attaches the same file twice", async () => {
    const id = await post("drafted", [assetIds[0]!]);
    const out = await mod.withTenant(tenant, () => attach.attachCreativeToPost(id, [assetIds[0]!, assetIds[1]!, assetIds[1]!], "me@test"));
    expect(out.attached).toBe(1);
    expect((await read(id)).assetIds).toEqual([assetIds[0], assetIds[1]]);
  });

  it("leaves a draft a draft", async () => {
    const id = await post("drafted");
    const out = await mod.withTenant(tenant, () => attach.attachCreativeToPost(id, [assetIds[0]!], "me@test"));
    expect(out.sentBackToDraft).toBe(false);
    expect((await read(id)).status).toBe("drafted");
  });

  it("sends an approved post back to draft, because the approval was for other pictures", async () => {
    for (const status of ["in_review", "approved", "scheduled"]) {
      const id = await post(status);
      const out = await mod.withTenant(tenant, () => attach.attachCreativeToPost(id, [assetIds[0]!], "me@test"));
      expect(out.sentBackToDraft, status).toBe(true);
      expect((await read(id)).status, status).toBe("drafted");
    }
  });

  it("withdraws the approval that was waiting on it", async () => {
    const id = await post("in_review");
    await mod.withTenant(tenant, () =>
      mod.db.insert(mod.approvals).values({ kind: "post", channel: "instagram", title: "Waiting", body: "Waiting for a decision", reason: "Drafted by the content agent", agent: "content", calendarItemId: id, status: "pending" }),
    );
    await mod.withTenant(tenant, () => attach.attachCreativeToPost(id, [assetIds[0]!], "me@test"));
    const rows = await mod.withTenant(tenant, () => mod.db.select().from(mod.approvals).where(eq(mod.approvals.calendarItemId, id)));
    expect(rows[0]!.status).toBe("withdrawn");
    expect(rows[0]!.decisionNote).toContain("me@test");
  });

  it("refuses to touch a published post", async () => {
    const id = await post("published", [assetIds[0]!]);
    const out = await mod.withTenant(tenant, () => attach.attachCreativeToPost(id, [assetIds[1]!], "me@test"));
    expect(out.attached).toBe(0);
    expect(out.message).toMatch(/already published/);
    expect((await read(id)).assetIds).toEqual([assetIds[0]]);
  });

  it("does nothing at all for an id that is not a post", async () => {
    const out = await mod.withTenant(tenant, () =>
      attach.attachCreativeToPost("11111111-1111-1111-1111-111111111111", [assetIds[0]!], "me@test"),
    );
    expect(out).toEqual({ message: null, attached: 0, sentBackToDraft: false });
  });
});
