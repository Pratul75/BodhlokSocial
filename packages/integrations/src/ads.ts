/**
 * Ad changes, always through the guardrails. requestChange() builds the guardrail's inputs from
 * data (caps from the budgets table, spend from ad_spend_daily, "losing" from per-ad results),
 * records the decision in ad_changes, then applies the change, sends it to Approvals, or stops.
 * applyChange() is the only code that writes to the ad platforms.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { adChanges, adEntities, approvals, auditLog, budgets, connections, creativePerformance, db, experiments } from "@bodh/db";
import { checkAdChange, isLosingAd, lintAdCopy, lintPositioning, MAX_TEST_VARIANTS, type AdChange, type Decision } from "@bodh/guardrails";
import {
  fetchGoogleStructure,
  fetchMetaStructure,
  googleCreateVariant,
  googleSetAdStatus,
  googleSetBid,
  googleSetBudget,
  metaCreateVariant,
  metaSetBid,
  metaSetBudget,
  metaSetStatus,
  type Entity,
  type Platform,
  type VariantCopy,
} from "./ads-platforms";
import { googleAdsConfigFromEnv, type GoogleAdsConfig } from "./google-ads";
import { refreshAccessToken, type StoredGoogleGrant } from "./google-oauth";
import type { MarketingCredentials } from "./meta";
import { readJsonSecret } from "./secrets";

export const PLATFORM_LABELS: Record<Platform, string> = { meta_ads: "Meta", google_ads: "Google Ads" };
const IST = 330 * 60_000;
const istDay = (d = new Date()) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

/* ---------- credentials ---------- */

export async function metaCreds(): Promise<MarketingCredentials | null> {
  const c = await readJsonSecret<MarketingCredentials>("meta_marketing");
  return c?.ad_account_id && c.access_token ? c : null;
}

export async function googleAuth(): Promise<{ cfg: GoogleAdsConfig; token: string } | null> {
  const cfg = googleAdsConfigFromEnv();
  const grant = cfg ? await readJsonSecret<StoredGoogleGrant>("google_ads") : null;
  if (!cfg || !grant?.refresh_token) return null;
  return { cfg, token: (await refreshAccessToken(grant.refresh_token)).access_token };
}

/* ---------- structure sync ---------- */

async function saveEntities(platform: Platform, list: Entity[]) {
  const now = new Date();
  for (const e of list) {
    const values = {
      platform,
      level: e.level,
      platformId: e.platformId,
      parentId: e.parentId,
      campaignId: e.campaignId,
      name: e.name,
      status: e.status,
      objective: e.objective ?? null,
      dailyBudget: e.dailyBudget?.toFixed(2) ?? null,
      bid: e.bid?.toFixed(2) ?? null,
      bidKind: e.bidKind,
      details: e.details,
      syncedAt: now,
    };
    await db.insert(adEntities).values(values).onConflictDoUpdate({ target: [adEntities.platform, adEntities.platformId], set: values });
  }
  // Anything the platform no longer returns has been removed there.
  await db
    .update(adEntities)
    .set({ status: "removed" })
    .where(and(eq(adEntities.platform, platform), sql`${adEntities.syncedAt} < ${now.toISOString()}::timestamptz`, ne(adEntities.status, "removed")));
}

/** Campaigns, ad sets and ads from each connected platform. */
export async function syncAdStructure(): Promise<string> {
  const out: string[] = [];
  const meta = await metaCreds();
  if (meta) {
    const list = await fetchMetaStructure(meta);
    await saveEntities("meta_ads", list);
    out.push(`Meta: ${list.filter((e) => e.level === "ad").length} ads`);
  }
  const google = await googleAuth().catch(() => null);
  if (google) {
    const list = await fetchGoogleStructure(google.cfg, google.token);
    await saveEntities("google_ads", list);
    out.push(`Google Ads: ${list.filter((e) => e.level === "ad").length} ads`);
  }
  return out.join("; ") || "No ad platform connected.";
}

/* ---------- spend and performance ---------- */

export interface SpendNow {
  platform: Platform;
  dailyCap: number;
  monthlyCap: number;
  spentToday: number;
  spentThisMonth: number;
  /** Daily budgets of everything running now. */
  committedDaily: number;
}

export async function spendNow(platform: Platform): Promise<SpendNow | null> {
  const [cap] = await db.select().from(budgets).where(eq(budgets.platform, platform));
  if (!cap) return null;
  const today = istDay();
  const [s] = (await db.execute(sql`
    SELECT coalesce(sum(spend) FILTER (WHERE day = ${today}::date), 0)::float AS today,
      coalesce(sum(spend) FILTER (WHERE day >= date_trunc('month', ${today}::date)), 0)::float AS month
    FROM ad_spend_daily WHERE platform = ${platform}`)) as unknown as { today: number; month: number }[];
  const ents = await db.select().from(adEntities).where(and(eq(adEntities.platform, platform), eq(adEntities.status, "active")));
  let committed = 0;
  for (const c of ents.filter((e) => e.level === "campaign")) {
    if (c.dailyBudget) committed += Number(c.dailyBudget);
    else committed += ents.filter((e) => e.level === "ad_set" && e.parentId === c.platformId && e.dailyBudget).reduce((t, e) => t + Number(e.dailyBudget), 0);
  }
  return { platform, dailyCap: cap.dailyCap, monthlyCap: cap.monthlyCap, spentToday: s?.today ?? 0, spentThisMonth: s?.month ?? 0, committedDaily: committed };
}

export const JUDGE_DAYS = 14;

/** Spend and activations per ad over the last N days ending today. */
export async function adResults(days = JUDGE_DAYS) {
  const to = istDay();
  const from = istDay(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = await creativePerformance(from, to, 5000);
  return new Map(rows.map((r) => [`${r.platform}:${r.adId}`, r]));
}

/** Code's verdict on whether an ad is losing, from its ad set's results. */
export async function judgeAd(ad: typeof adEntities.$inferSelect, judged?: Map<string, { spend: number; activations: number }>) {
  const results = judged ?? (await adResults());
  const siblings = await db.select().from(adEntities).where(and(eq(adEntities.platform, ad.platform), eq(adEntities.level, "ad"), eq(adEntities.parentId, ad.parentId ?? "")));
  const stat = (id: string) => {
    const r = results.get(`${ad.platform}:${id}`);
    return { adId: id, spend: r?.spend ?? 0, activations: r?.activations ?? 0 };
  };
  const verdict = isLosingAd(stat(ad.platformId), siblings.map((s) => stat(s.platformId)));
  const othersActive = siblings.filter((s) => s.platformId !== ad.platformId && s.status === "active").length;
  return { ...verdict, lastActiveInAdSet: othersActive === 0, stats: stat(ad.platformId) };
}

/* ---------- change requests ---------- */

export type ChangeRequest =
  | { type: "pause_ad"; platform: Platform; adId: string }
  | { type: "resume_ad"; platform: Platform; adId: string }
  | { type: "bid_change"; platform: Platform; entityId: string; newBid: number }
  | { type: "budget_change"; platform: Platform; entityId: string; newDaily: number }
  | { type: "new_campaign"; platform: Platform; name: string; objective: string; dailyBudget: number; plan: string }
  | { type: "ab_test"; platform: Platform; baseAdId: string; hypothesis: string; variants: VariantCopy[] };

export interface Actor {
  name: string; // "ads agent" or a person's email
  kind: "agent" | "user";
  runId?: string | null;
}

export interface ChangeResult {
  outcome: "applied" | "sent_to_approval" | "blocked" | "failed";
  changeId: string;
  message: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

async function entity(platform: Platform, platformId: string) {
  const [e] = await db.select().from(adEntities).where(and(eq(adEntities.platform, platform), eq(adEntities.platformId, platformId))).limit(1);
  return e ?? null;
}

function copyProblems(platform: Platform, variants: VariantCopy[]): string[] {
  const out: string[] = [];
  for (const v of variants) {
    const all = [v.headline, v.text, ...(v.headlines ?? []), ...(v.descriptions ?? [])].filter(Boolean).join("\n");
    for (const i of lintAdCopy(all)) out.push(`${v.name}: "${i.match}" (${i.why.toLowerCase()})`);
    for (const i of lintPositioning(all)) if (i.level === "error") out.push(`${v.name}: "${i.match}" (${i.why.toLowerCase()})`);
    if (platform === "google_ads") {
      if ((v.headlines?.length ?? 0) < 3 || (v.headlines?.length ?? 0) > 15) out.push(`${v.name}: Google needs 3 to 15 headlines.`);
      if ((v.descriptions?.length ?? 0) < 2 || (v.descriptions?.length ?? 0) > 4) out.push(`${v.name}: Google needs 2 to 4 descriptions.`);
      for (const h of v.headlines ?? []) if (h.length > 30) out.push(`${v.name}: headline "${h}" is over 30 characters.`);
      for (const d of v.descriptions ?? []) if (d.length > 90) out.push(`${v.name}: description "${d.slice(0, 30)}…" is over 90 characters.`);
    } else {
      if (!v.text || v.text.length > 1000) out.push(`${v.name}: primary text is required, up to 1,000 characters.`);
      if (!v.headline || v.headline.length > 60) out.push(`${v.name}: headline is required, up to 60 characters.`);
    }
  }
  return out;
}

export async function requestChange(req: ChangeRequest, reason: string, actor: Actor): Promise<ChangeResult> {
  const caps = await spendNow(req.platform);
  let guard: AdChange;
  let label: string;
  let target: typeof adEntities.$inferSelect | null = null;
  let before: Record<string, unknown> = {};
  let after: Record<string, unknown> = {};
  let extra: Decision | null = null;

  switch (req.type) {
    case "pause_ad":
    case "resume_ad": {
      target = await entity(req.platform, req.adId);
      if (!target || target.level !== "ad") return record(req, null, "blocked", `No ${PLATFORM_LABELS[req.platform]} ad ${req.adId}. Sync the accounts first.`, reason, actor);
      if (req.type === "pause_ad") {
        if (target.status !== "active") return record(req, target, "blocked", "The ad isn't running.", reason, actor);
        const j = await judgeAd(target);
        guard = { type: "pause_ad", adId: req.adId, isLosing: j.losing, lastActiveInAdSet: j.lastActiveInAdSet };
        label = `Pause ad "${target.name}"`;
        after = { status: "paused", verdict: j.reason, spend: j.stats.spend, activations: j.stats.activations };
      } else {
        if (target.status === "active") return record(req, target, "blocked", "The ad is already running.", reason, actor);
        guard = { type: "resume_ad", adId: req.adId };
        label = `Resume ad "${target.name}"`;
        after = { status: "active" };
      }
      before = { status: target.status };
      break;
    }
    case "bid_change": {
      target = await entity(req.platform, req.entityId);
      if (!target?.bid) return record(req, target, "blocked", "That campaign or ad set has no manual bid or target CPA to change.", reason, actor);
      guard = { type: "bid_change", adSetId: req.entityId, currentBid: Number(target.bid), newBid: req.newBid };
      label = `${target.bidKind === "target_cpa" ? "Target CPA" : "Bid"} on "${target.name}": ${inr(Number(target.bid))} → ${inr(req.newBid)}`;
      before = { bid: Number(target.bid), bidKind: target.bidKind };
      after = { bid: req.newBid };
      break;
    }
    case "budget_change": {
      target = await entity(req.platform, req.entityId);
      if (!target?.dailyBudget) return record(req, target, "blocked", "That campaign or ad set doesn't own a daily budget.", reason, actor);
      guard = { type: "budget_change", adSetId: req.entityId, currentDaily: Number(target.dailyBudget), newDaily: req.newDaily };
      label = `Daily budget on "${target.name}": ${inr(Number(target.dailyBudget))} → ${inr(req.newDaily)}`;
      before = { dailyBudget: Number(target.dailyBudget) };
      after = { dailyBudget: req.newDaily };
      break;
    }
    case "new_campaign": {
      guard = { type: "new_campaign", name: req.name, dailyBudget: req.dailyBudget };
      label = `New ${PLATFORM_LABELS[req.platform]} campaign "${req.name}" at ${inr(req.dailyBudget)} a day`;
      after = { name: req.name, objective: req.objective, dailyBudget: req.dailyBudget, plan: req.plan };
      break;
    }
    case "ab_test": {
      target = await entity(req.platform, req.baseAdId);
      if (!target || target.level !== "ad" || !target.parentId) return record(req, target, "blocked", "No base ad with that id.", reason, actor);
      guard = { type: "ab_test", adSetId: target.parentId, variants: req.variants.length };
      label = `A/B test in "${(await entity(req.platform, target.parentId))?.name ?? target.parentId}": ${req.variants.length} new variant${req.variants.length === 1 ? "" : "s"} against "${target.name}"`;
      before = { baseAd: target.platformId, baseCopy: target.details };
      after = { hypothesis: req.hypothesis, variants: req.variants };
      const problems = copyProblems(req.platform, req.variants);
      if (problems.length) extra = { outcome: "block", reason: `Copy problems: ${problems.join("; ")}` };
      const [running] = await db.select({ id: experiments.id }).from(experiments).where(and(eq(experiments.entityId, target.parentId), inArray(experiments.status, ["proposed", "running"]))).limit(1);
      if (running) extra = { outcome: "block", reason: "A test is already running or waiting in that ad set; one at a time." };
      break;
    }
  }

  const decision: Decision = extra ?? (caps ? checkAdChange(guard, { dailyCap: caps.dailyCap, monthlyCap: caps.monthlyCap }, caps) : { outcome: "block", reason: `No spend caps set for ${PLATFORM_LABELS[req.platform]}.` });
  const [row] = await db
    .insert(adChanges)
    .values({
      change: label,
      outcome: decision.outcome === "allow" ? "applying" : decision.outcome === "needs_approval" ? "sent_to_approval" : "blocked",
      reason,
      guardrail: decision.reason,
      actor: actor.name,
      platform: req.platform,
      type: req.type,
      level: target?.level ?? (req.type === "new_campaign" ? "campaign" : null),
      entityId: target?.platformId ?? null,
      entityName: target?.name ?? (req.type === "new_campaign" ? req.name : null),
      before,
      after,
      runId: actor.runId ?? null,
    })
    .returning();
  await db.insert(auditLog).values({ actor: actor.name, actorType: actor.kind, action: `ad_${req.type}`, target: label, reason, result: `${decision.outcome}: ${decision.reason}` });

  if (decision.outcome === "block") return { outcome: "blocked", changeId: row!.id, message: `Blocked: ${decision.reason}` };
  if (decision.outcome === "needs_approval") {
    const variantsText = req.type === "ab_test" ? `\n\n${req.variants.map((v) => `${v.name}:\n${v.headline ?? v.headlines?.join(" | ") ?? ""}\n${v.text ?? v.descriptions?.join(" | ") ?? ""}`).join("\n\n")}` : "";
    if (req.type === "ab_test") {
      await db.insert(experiments).values({ platform: req.platform, hypothesis: req.hypothesis, status: "proposed", startedAt: istDay(), entityId: target!.parentId, entityName: label, variants: [{ name: `Control: ${target!.name}`, cpa: null, adId: target!.platformId }, ...req.variants.map((v) => ({ name: v.name, cpa: null }))], runId: actor.runId ?? null });
    }
    const [appr] = await db
      .insert(approvals)
      .values({
        kind: "ad_change",
        channel: req.platform,
        agent: actor.kind === "agent" ? actor.name.replace(/ agent$/, "") : "ads",
        title: label,
        body: `${reason}${variantsText}`,
        reason: `Guardrail: ${decision.reason}`,
        payload: { adChangeId: row!.id, type: req.type, platform: req.platform },
        sourceRunId: actor.runId ?? null,
      })
      .returning({ id: approvals.id });
    await db.update(adChanges).set({ approvalId: appr!.id }).where(eq(adChanges.id, row!.id));
    return { outcome: "sent_to_approval", changeId: row!.id, message: `Sent to Approvals: ${decision.reason}` };
  }
  const applied = await applyChange(row!.id);
  return { outcome: applied.ok ? "applied" : "failed", changeId: row!.id, message: applied.ok ? `Applied. ${decision.reason}` : `Allowed, but the platform refused: ${applied.error}` };
}

async function record(req: ChangeRequest, target: typeof adEntities.$inferSelect | null, outcome: "blocked", why: string, reason: string, actor: Actor): Promise<ChangeResult> {
  const [row] = await db
    .insert(adChanges)
    .values({ change: `${req.type.replace(/_/g, " ")}${target ? ` "${target.name}"` : ""}`, outcome, reason, guardrail: why, actor: actor.name, platform: req.platform, type: req.type, entityId: target?.platformId ?? null, entityName: target?.name ?? null, runId: actor.runId ?? null })
    .returning({ id: adChanges.id });
  return { outcome, changeId: row!.id, message: `Blocked: ${why}` };
}

/* ---------- applying ---------- */

/** Writes an allowed or approved change to the platform. The only place that does. */
export async function applyChange(changeId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [c] = await db.select().from(adChanges).where(eq(adChanges.id, changeId)).limit(1);
  if (!c?.platform || !c.type) return { ok: false, error: "Unknown change." };
  const platform = c.platform as Platform;
  const after = c.after ?? {};
  try {
    const target = c.entityId ? await entity(platform, c.entityId) : null;
    const meta = platform === "meta_ads" ? await metaCreds() : null;
    const google = platform === "google_ads" ? await googleAuth() : null;
    if (c.type !== "new_campaign" && !meta && !google) throw new Error(`${PLATFORM_LABELS[platform]} isn't connected.`);

    switch (c.type) {
      case "pause_ad":
      case "resume_ad": {
        const status = c.type === "pause_ad" ? "paused" : "active";
        if (meta) await metaSetStatus(meta, target!.platformId, status);
        else await googleSetAdStatus(google!.cfg, google!.token, target!.parentId!, target!.platformId, status);
        await db.update(adEntities).set({ status }).where(eq(adEntities.id, target!.id));
        if (c.type === "pause_ad") await settleExperiment(platform, target!);
        break;
      }
      case "bid_change": {
        const bid = Number(after.bid);
        if (meta) await metaSetBid(meta, target!.platformId, bid);
        else await googleSetBid(google!.cfg, google!.token, { level: target!.level as "campaign" | "ad_set" | "ad", platformId: target!.platformId, bidKind: target!.bidKind }, bid);
        await db.update(adEntities).set({ bid: bid.toFixed(2) }).where(eq(adEntities.id, target!.id));
        break;
      }
      case "budget_change": {
        const daily = Number(after.dailyBudget);
        if (meta) await metaSetBudget(meta, target!.platformId, daily);
        else {
          const res = String(target!.details.budgetResource ?? "");
          if (!res) throw new Error("No campaign budget to change.");
          await googleSetBudget(google!.cfg, google!.token, res, daily);
        }
        await db.update(adEntities).set({ dailyBudget: daily.toFixed(2) }).where(eq(adEntities.id, target!.id));
        break;
      }
      case "new_campaign":
        // Approved as a plan: a person builds it in the platform (targeting, creative, tracking);
        // the next sync picks it up and the caps apply from then on.
        await db.update(adChanges).set({ outcome: "approved", appliedAt: new Date(), error: null }).where(eq(adChanges.id, changeId));
        return { ok: true };
      case "ab_test": {
        const variants = (after.variants as VariantCopy[]) ?? [];
        const ids: { name: string; adId: string }[] = [];
        for (const v of variants) {
          const base = { platformId: target!.platformId, parentId: target!.parentId ?? "", details: target!.details };
          const adId = meta ? await metaCreateVariant(meta, base, v) : await googleCreateVariant(google!.cfg, google!.token, base, v);
          ids.push({ name: v.name, adId });
        }
        const [exp] = await db
          .select()
          .from(experiments)
          .where(and(eq(experiments.entityId, target!.parentId ?? ""), eq(experiments.status, "proposed")))
          .orderBy(desc(experiments.startedAt))
          .limit(1);
        const variantRows = [{ name: `Control: ${target!.name}`, cpa: null, adId: target!.platformId }, ...ids.map((i) => ({ name: i.name, cpa: null, adId: i.adId }))];
        if (exp) await db.update(experiments).set({ status: "running", variants: variantRows, startedAt: istDay() }).where(eq(experiments.id, exp.id));
        else await db.insert(experiments).values({ platform, hypothesis: String(after.hypothesis ?? ""), status: "running", startedAt: istDay(), entityId: target!.parentId, variants: variantRows });
        await syncAdStructure().catch(() => undefined);
        break;
      }
    }
    await db.update(adChanges).set({ outcome: "applied", appliedAt: new Date(), error: null }).where(eq(adChanges.id, changeId));
    return { ok: true };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.update(adChanges).set({ outcome: "failed", error }).where(eq(adChanges.id, changeId));
    return { ok: false, error };
  }
}

/** A person rejected it in Approvals. */
export async function rejectChange(changeId: string, note: string | null) {
  const [c] = await db.update(adChanges).set({ outcome: "rejected", error: note }).where(eq(adChanges.id, changeId)).returning();
  if (c?.type === "ab_test" && c.entityId) {
    const [base] = await db.select().from(adEntities).where(and(eq(adEntities.platform, c.platform ?? ""), eq(adEntities.platformId, c.entityId)));
    await db.update(experiments).set({ status: "stopped", endedAt: new Date() }).where(and(eq(experiments.entityId, base?.parentId ?? ""), eq(experiments.status, "proposed")));
  }
}

/** When a test variant is paused for losing and one variant is left running, it has won. */
async function settleExperiment(platform: Platform, ad: typeof adEntities.$inferSelect) {
  const running = await db.select().from(experiments).where(and(eq(experiments.platform, platform), eq(experiments.entityId, ad.parentId ?? ""), eq(experiments.status, "running")));
  for (const exp of running) {
    if (!exp.variants.some((v) => v.adId === ad.platformId)) continue;
    const ids = exp.variants.map((v) => v.adId).filter((x): x is string => !!x);
    const live = await db.select().from(adEntities).where(and(eq(adEntities.platform, platform), inArray(adEntities.platformId, ids), eq(adEntities.status, "active")));
    const results = await adResults();
    const variants = exp.variants.map((v) => {
      const r = v.adId ? results.get(`${platform}:${v.adId}`) : undefined;
      return { ...v, cpa: r?.activations ? Math.round(r.spend / r.activations) : null };
    });
    if (live.length <= 1) {
      const winner = live[0]?.platformId ?? null;
      const controlWon = winner === exp.variants[0]?.adId;
      await db.update(experiments).set({ variants, status: controlWon ? "lost" : "won", winnerAdId: winner, endedAt: new Date() }).where(eq(experiments.id, exp.id));
    } else {
      await db.update(experiments).set({ variants }).where(eq(experiments.id, exp.id));
    }
  }
}

/** Running tests with each variant's results so far. */
export async function testsWithResults() {
  const results = await adResults(60);
  const rows = await db.select().from(experiments).orderBy(desc(experiments.startedAt)).limit(30);
  return rows.map((t) => ({
    ...t,
    variants: t.variants.map((v) => {
      const r = v.adId ? results.get(`${t.platform}:${v.adId}`) : undefined;
      return { ...v, spend: r?.spend ?? 0, activations: r?.activations ?? 0, cpa: r?.activations ? Math.round(r.spend / r.activations) : v.cpa };
    }),
  }));
}

export async function adsConnected(): Promise<Record<Platform, boolean>> {
  const rows = await db.select().from(connections).where(inArray(connections.key, ["meta_marketing", "google_ads"]));
  return { meta_ads: rows.some((r) => r.key === "meta_marketing" && r.status === "connected"), google_ads: rows.some((r) => r.key === "google_ads" && r.status === "connected") && !!googleAdsConfigFromEnv() };
}

export { MAX_TEST_VARIANTS };
