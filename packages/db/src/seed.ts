/**
 * Sample data for local development. Every number here is invented; the UI shows
 * a "Sample data" badge while DEMO_DATA=true.
 */
import { db, sql } from "./client";
import * as s from "./schema";

const DAY = 86_400_000;
const today = new Date();
today.setHours(0, 0, 0, 0);
const dayOffset = (n: number) => new Date(today.getTime() + n * DAY);
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (n: number, hour: number, min = 0) => {
  const d = dayOffset(n);
  d.setHours(hour, min, 0, 0);
  return d;
};

// Small deterministic PRNG so the seed is stable between runs.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const jitter = (base: number, spread = 0.25) => Math.max(0, Math.round(base * (1 - spread + rand() * spread * 2)));

async function main() {
  console.log("Clearing tables…");
  await sql`TRUNCATE audit_log, leads, community_items, ai_visibility_checks, seo_pages, keywords, funnel_daily,
    budgets, experiments, ad_changes, campaigns, strategy_plans, calendar_items, assets, approvals, agent_runs,
    connections, users RESTART IDENTITY CASCADE`;

  const userRows = await db
    .insert(s.users)
    .values([
      { email: process.env.DEV_USER_EMAIL ?? "kshitij@rechargestudio.com", name: "Kshitij Shivprasad", role: "admin" },
      { email: "ads@rechargestudio.com", name: "Ads Manager", role: "ads_manager" },
      { email: "seo@rechargestudio.com", name: "SEO Manager", role: "seo_manager" },
      { email: "social@rechargestudio.com", name: "Social Media Manager", role: "social_manager" },
      { email: "sales@rechargestudio.com", name: "Sales Lead", role: "sales" },
    ])
    .returning();
  const sales = userRows.find((u) => u.role === "sales")!;

  const keys = [
    "anthropic", "vertex", "google_ads", "meta_marketing", "meta_capi", "postiz", "meta_pages", "youtube", "linkedin",
    "reddit", "quora", "gbp", "search_console", "dataforseo", "semrush", "ga4", "whatsapp", "email", "bodh",
  ];
  await db.insert(s.connections).values(keys.map((key) => ({ key })));

  const runs = await db
    .insert(s.agentRuns)
    .values([
      { agent: "content", trigger: "schedule", status: "succeeded", summary: "Drafted 6 calendar items for next week", tokensIn: 48210, tokensOut: 9120, costUsd: "0.3754", startedAt: at(0, 6, 0), finishedAt: at(0, 6, 4) },
      { agent: "ads", trigger: "schedule", status: "succeeded", summary: "Paused 1 losing Meta ad, proposed 1 budget increase", tokensIn: 31200, tokensOut: 2410, costUsd: "0.1730", startedAt: at(0, 7, 0), finishedAt: at(0, 7, 2) },
      { agent: "community", trigger: "schedule", status: "succeeded", summary: "Found 5 questions, drafted 3 answers", tokensIn: 22870, tokensOut: 3980, costUsd: "0.1711", startedAt: at(0, 8, 0), finishedAt: at(0, 8, 3) },
      { agent: "seo", trigger: "schedule", status: "failed", summary: "DataForSEO is not connected", tokensIn: 1200, tokensOut: 140, costUsd: "0.0076", startedAt: at(-1, 5, 0), finishedAt: at(-1, 5, 0) },
      { agent: "analyst", trigger: "schedule", status: "succeeded", summary: "Weekly funnel report: cost per activated user ₹61 (down 9%)", tokensIn: 40110, tokensOut: 5230, costUsd: "0.2650", startedAt: at(-3, 9, 0), finishedAt: at(-3, 9, 5) },
    ])
    .returning();
  const [contentRun, adsRun, communityRun] = runs;

  await db.insert(s.approvals).values([
    {
      kind: "post", channel: "instagram", agent: "content", sourceRunId: contentRun!.id,
      title: "Reel: 40 minutes of manual calculation, done in 4 seconds",
      body: "Hook (0–2s): \"Still calculating Drishti by hand?\"\nShow: an astrologer's notebook full of degree maths, then BODH drawing the same chart.\nVO: \"BODH calculates every aspect the classical way, in seconds.\"\nCTA: \"Register free. Your first chart is on us.\"",
      reason: "Problem-first hook. Our two best reels last month both opened on the manual-calculation pain.",
      payload: { format: "reel", length: "22s" },
    },
    {
      kind: "post", channel: "youtube", agent: "content", sourceRunId: contentRun!.id,
      title: "Short: What your Moon Nakshatra says about how you decide",
      body: "Title: What your Moon Nakshatra says about how you decide\nHook: \"Your Moon sign is not the whole story.\"\nBody: 3 Nakshatras, one line each, with the classical reference shown on screen.\nEnd card: \"Find yours free on BODH.\"",
      reason: "Mass-audience format. Nakshatra Shorts average 2.1x the views of software demos.",
      payload: { format: "short", needsJyotishReview: true },
    },
    {
      kind: "ad_change", channel: "meta_ads", agent: "ads", sourceRunId: adsRun!.id,
      title: "Raise \"Astrologer pain — video viewers 50%\" budget ₹1,500 → ₹2,000/day",
      body: "Ad set: Astrologer pain — video viewers 50%\nCurrent daily budget: ₹1,500\nProposed: ₹2,000\nCost per activated user, last 7 days: ₹44 (account average ₹61)",
      reason: "Lowest cost per activated user in the account for 7 straight days. Budget increases always need approval.",
      payload: { type: "budget_change", currentDaily: 1500, newDaily: 2000 },
    },
    {
      kind: "reply", channel: "reddit", agent: "community", sourceRunId: communityRun!.id,
      title: "r/vedicastrology: \"Which software calculates Drishti correctly?\"",
      body: "Posting as the Asttrolok team account.\n\n\"Full disclosure, we build BODH. Most tools get Drishti right for the standard 7th aspect but differ on the special aspects of Mars, Jupiter and Saturn. Whatever you use, check those against a manual calculation for one chart you know well. Happy to share the reference we use.\"",
      reason: "Real question, 34 upvotes, asked 6 hours ago. Answer discloses who we are.",
      payload: { url: "https://www.reddit.com/r/vedicastrology/" },
    },
    {
      kind: "blog", channel: "seo", agent: "seo",
      title: "Blog: Saturn in the 7th house — meaning, effects and remedies",
      body: "Direct answer (top of page, 48 words), then sections on marriage, career and Sade Sati overlap. Internal links to the free Kundli tool and the Saturn-in-houses hub.",
      reason: "Keyword \"saturn in 7th house\" has 14,800 monthly searches and our page ranks 18th.",
      payload: { keyword: "saturn in 7th house", needsJyotishReview: true },
    },
    {
      kind: "listing", channel: "seo", agent: "mentions",
      title: "Directory listing: AlternativeTo — BODH",
      body: "Category: Astrology software\nDescription: Vedic astrology software for astrologers and students. Generate Kundli, Dasha and Drishti with classical rules.\nAlternatives listed against: Jagannatha Hora, Parashara's Light",
      reason: "Ranks for \"jagannatha hora alternative\" (2,400 searches a month). Free listing with a followed link.",
      payload: {},
    },
    {
      kind: "post", channel: "linkedin", agent: "content", sourceRunId: contentRun!.id,
      title: "LinkedIn: Why we rebuilt Drishti from the classical texts",
      body: "Founder post for Alok Khandelwal's page. 180 words on why BODH's calculations follow BPHS, with one diagram.",
      reason: "Teacher partnerships come from LinkedIn. Founder posts get 3x the reach of company page posts.",
      payload: { format: "post" },
    },
    {
      kind: "ad_change", channel: "google_ads", agent: "ads",
      title: "New campaign: Search — \"kundli software\" exact match",
      body: "Campaign: Search — kundli software\nKeywords: kundli software, vedic astrology software, kundli software for astrologers\nDaily budget: ₹1,200\nLanding page: /free-kundli",
      reason: "Competitor keywords show 9,900 searches a month with low ad competition. New campaigns always need approval.",
      payload: { type: "new_campaign", dailyBudget: 1200 },
    },
  ]);

  const items: (typeof s.calendarItems.$inferInsert)[] = [];
  const plan: [number, string, string, string, string][] = [
    [-9, "instagram", "reel", "Manual calculation vs BODH: 40 minutes to 4 seconds", "published"],
    [-8, "youtube", "short", "3 Nakshatras that make natural teachers", "published"],
    [-7, "instagram", "carousel", "5 yogas every beginner should recognise", "published"],
    [-6, "youtube", "long_video", "Full walkthrough: reading a Kundli in BODH", "published"],
    [-5, "linkedin", "post", "Why we rebuilt Drishti from the classical texts", "published"],
    [-4, "instagram", "reel", "Your Lagna in 10 seconds", "failed"],
    [-3, "youtube", "short", "Moon in Rohini: what it means", "published"],
    [-2, "facebook", "image", "Today's Panchang, Indore", "published"],
    [-1, "instagram", "reel", "Wrong Drishti? Here is how to check", "published"],
    [0, "youtube", "short", "What your Moon Nakshatra says about how you decide", "in_review"],
    [0, "instagram", "reel", "40 minutes of manual calculation, done in 4 seconds", "in_review"],
    [1, "seo", "blog", "Saturn in the 7th house", "in_review"],
    [1, "instagram", "carousel", "Dasha periods explained in 6 slides", "drafted"],
    [2, "youtube", "short", "Jupiter's special aspects, shown on a chart", "drafted"],
    [2, "linkedin", "post", "Teacher program: how referral codes work", "approved"],
    [3, "instagram", "reel", "Free Kundli in 3 taps", "scheduled"],
    [4, "youtube", "long_video", "Muhurat finder: choosing a date the classical way", "drafted"],
    [5, "instagram", "image", "Today's Panchang, Mumbai", "scheduled"],
    [6, "youtube", "short", "Mars in the 8th house: myths vs texts", "idea"],
    [7, "instagram", "reel", "Students vs software: who calculates faster?", "idea"],
    [8, "seo", "blog", "Rahu in the 10th house", "idea"],
    [9, "facebook", "post", "Webinar: Kundli matching with BODH", "idea"],
    [11, "youtube", "short", "Gajakesari yoga, explained", "idea"],
    [13, "instagram", "carousel", "Ashtakavarga in plain words", "idea"],
  ];
  for (const [d, channel, format, idea, status] of plan) {
    items.push({
      channel, format, idea, status,
      scheduledAt: at(d, format === "blog" ? 9 : 18, 30),
      caption: status === "idea" ? null : `${idea}. Register free on BODH, your first chart is on us.`,
      error: status === "failed" ? "Instagram rejected the upload: video longer than 90 seconds" : null,
    });
  }
  await db.insert(s.calendarItems).values(items);

  await db.insert(s.assets).values([
    { name: "drishti-notebook.jpg", type: "image", source: "upload", storagePath: "assets/drishti-notebook.jpg", width: 1080, height: 1350 },
    { name: "nakshatra-wheel.png", type: "image", source: "imagen", storagePath: "assets/nakshatra-wheel.png", width: 1080, height: 1080 },
    { name: "kundli-3-taps.mp4", type: "video", source: "upload", storagePath: "assets/kundli-3-taps.mp4", width: 1080, height: 1920 },
    { name: "panchang-card-mumbai.png", type: "image", source: "imagen", storagePath: "assets/panchang-card-mumbai.png", width: 1080, height: 1350 },
    { name: "saturn-7th-thumbnail.png", type: "image", source: "imagen", storagePath: "assets/saturn-7th-thumbnail.png", width: 1280, height: 720 },
    { name: "teacher-program-intro.mp4", type: "video", source: "veo", storagePath: "assets/teacher-program-intro.mp4", width: 1920, height: 1080 },
  ]);

  const month = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  await db.insert(s.strategyPlans).values({
    month: isoDate(month),
    status: "draft",
    summary:
      "Double down on problem-first video for astrologers and launch the free Panchang tool. Shift 10% of Meta budget to the 50% video-viewer retargeting layer, which has the lowest cost per activated user.",
    pillars: [
      { name: "Astrologer pain → BODH fixes it", share: 35, why: "Lowest cost per activated user on both ad platforms" },
      { name: "Nakshatra and Lagna explainers", share: 30, why: "Top organic reach on Shorts and Reels" },
      { name: "Free tools walkthroughs", share: 20, why: "Every tool result ends in a free registration" },
      { name: "Teacher and student stories", share: 15, why: "Feeds the referral program launching this month" },
    ],
    bets: [
      { title: "Launch free Panchang tool with 40 city pages", metric: "Registrations from tool pages", target: "600 in the month" },
      { title: "Retargeting ladder on Meta", metric: "Cost per activated user", target: "Under ₹50" },
      { title: "Teacher referral program, first 20 teachers", metric: "Activated users via referral codes", target: "300" },
    ],
  });

  const campaignRows = await db
    .insert(s.campaigns)
    .values([
      { platform: "google_ads", name: "App — Install + register", objective: "App registrations", status: "active", dailyBudget: 2500, spend7d: 16840, clicks7d: 3120, registrations7d: 412, activations7d: 221 },
      { platform: "google_ads", name: "YouTube — Astrologer pain", objective: "Video views → registrations", status: "active", dailyBudget: 1200, spend7d: 8210, clicks7d: 1490, registrations7d: 168, activations7d: 92 },
      { platform: "google_ads", name: "Search — free kundli", objective: "Web registrations", status: "learning", dailyBudget: 800, spend7d: 4930, clicks7d: 860, registrations7d: 97, activations7d: 61 },
      { platform: "meta_ads", name: "Astrologer pain — video viewers 50%", objective: "Retargeting", status: "active", dailyBudget: 1500, spend7d: 10380, clicks7d: 2640, registrations7d: 331, activations7d: 236 },
      { platform: "meta_ads", name: "Nakshatra explainers — broad", objective: "Video engagement", status: "active", dailyBudget: 1000, spend7d: 6920, clicks7d: 2210, registrations7d: 118, activations7d: 49 },
      { platform: "meta_ads", name: "Lead form — teacher program", objective: "Leads", status: "paused", dailyBudget: 600, spend7d: 2100, clicks7d: 340, registrations7d: 22, activations7d: 9 },
    ])
    .returning();

  await db.insert(s.adChanges).values([
    { campaignId: campaignRows[4]!.id, change: "Paused ad \"Nakshatra carousel v2\"", outcome: "applied", reason: "Cost per activated user ₹212 over 3 days, 3.5x the account average. Pausing a losing ad is on the auto-allow list.", actor: "ads agent", createdAt: at(0, 7, 2) },
    { campaignId: campaignRows[3]!.id, change: "Budget ₹1,500 → ₹2,000/day", outcome: "sent_to_approval", reason: "Budget increases always need approval.", actor: "ads agent", createdAt: at(0, 7, 2) },
    { campaignId: campaignRows[0]!.id, change: "Target CPA ₹70 → ₹80", outcome: "applied", reason: "Bid moves 14%, within ±20%.", actor: "ads agent", createdAt: at(-1, 7, 1) },
    { campaignId: campaignRows[2]!.id, change: "Daily budget ₹800 → ₹3,000", outcome: "blocked", reason: "Proposal exceeded the ₹4,000 Google daily cap with other campaigns running.", actor: "ads agent", createdAt: at(-2, 7, 3) },
    { campaignId: campaignRows[5]!.id, change: "Paused campaign", outcome: "applied", reason: "Paused by a person while the teacher program page is rebuilt.", actor: "ads@rechargestudio.com", createdAt: at(-3, 15, 20) },
  ]);

  await db.insert(s.experiments).values([
    { platform: "meta_ads", hypothesis: "A notebook-full-of-maths opener beats a chart-reveal opener", variants: [{ name: "Notebook opener", cpa: 44 }, { name: "Chart reveal", cpa: 71 }], status: "won", startedAt: isoDate(dayOffset(-14)) },
    { platform: "google_ads", hypothesis: "\"Register free\" beats \"Try free\" on the App campaign", variants: [{ name: "Register free", cpa: 76 }, { name: "Try free", cpa: 79 }], status: "running", startedAt: isoDate(dayOffset(-5)) },
    { platform: "meta_ads", hypothesis: "Hindi voice-over beats English voice-over for Nakshatra reels", variants: [{ name: "Hindi VO", cpa: null }, { name: "English VO", cpa: null }], status: "running", startedAt: isoDate(dayOffset(-1)) },
  ]);

  await db.insert(s.budgets).values([
    { platform: "google_ads", dailyCap: 4000, monthlyCap: 110000, spentToday: 2310, spentThisMonth: 71240, updatedBy: "kshitij@rechargestudio.com" },
    { platform: "meta_ads", dailyCap: 3500, monthlyCap: 95000, spentToday: 2020, spentThisMonth: 58610, updatedBy: "kshitij@rechargestudio.com" },
  ]);

  const channelBase: Record<string, [number, number, number, number, number]> = {
    google_ads: [3500, 780, 96, 54, 2],
    meta_ads: [2800, 760, 70, 42, 1.2],
    youtube: [0, 420, 38, 22, 0.6],
    instagram: [0, 260, 19, 9, 0.2],
    seo: [0, 380, 44, 29, 0.9],
    referral: [0, 90, 17, 12, 0.5],
  };
  const funnel: (typeof s.funnelDaily.$inferInsert)[] = [];
  for (let d = -55; d <= -1; d++) {
    const growth = 1 + (d + 55) * 0.006; // slow upward trend
    for (const [channel, [spend, clicks, reg, act, paid]] of Object.entries(channelBase)) {
      const organicGrowth = spend === 0 ? growth * 1.004 ** (d + 55) : growth;
      funnel.push({
        day: isoDate(dayOffset(d)),
        channel,
        spend: jitter(spend, 0.1),
        clicks: jitter(clicks * organicGrowth),
        registrations: jitter(reg * organicGrowth),
        activations: jitter(act * organicGrowth),
        paid: Math.round(paid * organicGrowth * (0.5 + rand())),
      });
    }
  }
  await db.insert(s.funnelDaily).values(funnel);

  await db.insert(s.keywords).values([
    { keyword: "free kundli", volume: 201000, difficulty: 72, position: 34, intent: "tool", pageUrl: "/free-kundli" },
    { keyword: "kundli software", volume: 9900, difficulty: 38, position: 11, intent: "software", pageUrl: "/" },
    { keyword: "saturn in 7th house", volume: 14800, difficulty: 41, position: 18, intent: "learn", pageUrl: "/planets/saturn/7th-house" },
    { keyword: "today panchang", volume: 165000, difficulty: 66, position: null, intent: "tool", pageUrl: null },
    { keyword: "moon nakshatra calculator", volume: 6600, difficulty: 29, position: 7, intent: "tool", pageUrl: "/nakshatra-finder" },
    { keyword: "jagannatha hora alternative", volume: 2400, difficulty: 18, position: 5, intent: "software", pageUrl: "/compare/jagannatha-hora" },
    { keyword: "gajakesari yoga", volume: 12100, difficulty: 35, position: 23, intent: "learn", pageUrl: "/yogas/gajakesari" },
    { keyword: "vedic astrology software for astrologers", volume: 1300, difficulty: 22, position: 4, intent: "software", pageUrl: "/" },
  ]);

  const pages: (typeof s.seoPages.$inferInsert)[] = [];
  const planets = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"];
  planets.forEach((p, i) => {
    for (let h = 1; h <= 12; h++) {
      const n = i * 12 + h;
      pages.push({
        template: "planet_house",
        slug: `/planets/${p.toLowerCase()}/${h}-house`,
        title: `${p} in the ${h}${h === 1 ? "st" : h === 2 ? "nd" : h === 3 ? "rd" : "th"} house`,
        status: n <= 24 ? "live" : n <= 40 ? "in_review" : n <= 60 ? "drafted" : "planned",
        clicks28d: n <= 24 ? jitter(420 - n * 12, 0.4) : 0,
      });
    }
  });
  await db.insert(s.seoPages).values(pages);

  const questions = [
    "What is the best Vedic astrology software?",
    "How do I find my Moon Nakshatra?",
    "Which app gives accurate Kundli?",
    "What is today's Panchang?",
  ];
  const vis: (typeof s.aiVisibilityChecks.$inferInsert)[] = [];
  for (let w = 5; w >= 0; w--) {
    for (const q of questions) {
      for (const engine of ["chatgpt", "gemini", "perplexity"]) {
        vis.push({ question: q, engine, mentioned: rand() < 0.12 + (5 - w) * 0.06, checkedAt: isoDate(dayOffset(-w * 7)) });
      }
    }
  }
  await db.insert(s.aiVisibilityChecks).values(vis);

  await db.insert(s.communityItems).values([
    { platform: "reddit", url: "https://www.reddit.com/r/vedicastrology/", question: "Which software calculates Drishti correctly?", status: "in_review", draft: "Full disclosure, we build BODH…", foundAt: at(0, 2, 10) },
    { platform: "quora", url: "https://www.quora.com/", question: "How long does it take to learn to read a birth chart?", status: "drafted", draft: "About six months of steady practice for the basics…", foundAt: at(0, 3, 0) },
    { platform: "youtube", url: "https://www.youtube.com/", question: "Comment: \"Is there an app that shows Ashtakavarga properly?\"", status: "drafted", draft: "Yes, BODH shows Sarva and Bhinna Ashtakavarga…", foundAt: at(-1, 19, 0) },
    { platform: "reddit", url: "https://www.reddit.com/r/astrology/", question: "Sidereal vs tropical, which do Indian astrologers use?", status: "found", foundAt: at(0, 5, 45) },
    { platform: "quora", url: "https://www.quora.com/", question: "Can I generate a Kundli without birth time?", status: "posted", draft: "You can, but the Lagna and houses will be unreliable…", foundAt: at(-4, 12, 0) },
    { platform: "reddit", url: "https://www.reddit.com/r/vedicastrology/", question: "Free tools for Muhurat?", status: "skipped", foundAt: at(-2, 10, 0) },
  ]);

  const leadNames = ["Priya Sharma", "Rahul Verma", "Anjali Gupta", "Vikram Singh", "Neha Joshi", "Suresh Iyer", "Kavita Rao"];
  await db.insert(s.leads).values(
    leadNames.map((name, i) => ({
      source: i % 3 === 0 ? "google_lead_form" : "meta_lead_form",
      name,
      phone: `+91 98${String(10000000 + i * 7919).slice(0, 8)}`,
      interest: ["Teacher program", "Guru plan for my institute", "Jyotish plan", "Student discount"][i % 4]!,
      status: ["new", "new", "contacted", "qualified", "new", "won", "lost"][i]!,
      assignedTo: i % 2 === 0 ? sales.id : null,
      createdAt: at(-Math.floor(i / 2), 10 + i, 15),
    })),
  );

  await db.insert(s.auditLog).values([
    { actor: "ads agent", actorType: "agent", action: "pause_ad", target: "Nakshatra carousel v2", reason: "Cost per activated user ₹212 over 3 days", result: "applied", createdAt: at(0, 7, 2) },
    { actor: "ads agent", actorType: "agent", action: "budget_change", target: "Astrologer pain — video viewers 50%", reason: "Lowest cost per activated user", result: "sent_to_approval", createdAt: at(0, 7, 2) },
    { actor: "content agent", actorType: "agent", action: "draft_items", target: "6 calendar items", reason: "Daily content run", result: "sent_to_approval", createdAt: at(0, 6, 4) },
    { actor: "seo agent", actorType: "agent", action: "weekly_audit", target: "asttrolok.com", reason: "Weekly schedule", result: "failed: DataForSEO not connected", createdAt: at(-1, 5, 0) },
    { actor: "kshitij@rechargestudio.com", actorType: "user", action: "set_budget_cap", target: "google_ads", reason: "Q4 plan", result: "daily ₹4,000 / monthly ₹1,10,000", createdAt: at(-6, 11, 40) },
  ]);

  console.log("Seeded.");
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
