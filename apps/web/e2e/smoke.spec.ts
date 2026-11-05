import { expect, test, type Page } from "@playwright/test";

/** Every module renders for the admin, with its heading and without the error page. */
const MODULES: [string, RegExp][] = [
  ["/", /Good (morning|afternoon|evening)/],
  ["/strategy", /Strategy|No plan yet|\d{4}/],
  ["/calendar", /Content calendar|Calendar/],
  ["/creative", /Creative studio/],
  ["/approvals", /Approvals/],
  ["/publishing", /Publishing/],
  ["/ads", /Ads manager/],
  ["/seo", /SEO & GEO/],
  ["/seo/pages", /pages/i],
  ["/seo/listings", /Directory listings/],
  ["/community", /Community/],
  ["/leads", /Leads/],
  ["/analytics", /Analytics/],
  ["/tracking", /Tracking/],
  ["/chat", /Ask the agents/],
  ["/connections", /Connections/],
  ["/admin", /Admin/],
  ["/runs", /Agent runs/],
];

async function noErrorPage(page: Page) {
  await expect(page.getByText("This page couldn't load")).toHaveCount(0);
}

for (const [path, heading] of MODULES) {
  test(`${path} loads`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(heading);
    await noErrorPage(page);
  });
}

test("an idea added to the calendar opens in the editor", async ({ page }) => {
  await page.goto("/calendar");
  const idea = `E2E idea ${Date.now()}`;
  await page.getByPlaceholder(/Rahu in the 10th house/).fill(idea);
  await page.getByRole("button", { name: /add idea/i }).click();
  await page.getByRole("link", { name: /write the caption/i }).click();
  await expect(page.locator("input[name=\"idea\"]")).toHaveValue(idea);
  await noErrorPage(page);
});

test("a run opens its step log (live's Run Steps page)", async ({ page }) => {
  await page.goto("/runs");
  await page.locator("a[href^='/runs/']").first().click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByText("What it did")).toBeVisible();
  await expect(page.getByText("Steps", { exact: true })).toBeVisible();
  await noErrorPage(page);
});

test("a planned connection can't be given a key", async ({ page }) => {
  await page.goto("/connections");
  const card = page.locator("article", { hasText: "WhatsApp Business API" });
  await expect(card.getByRole("button", { name: "Not available yet" })).toBeDisabled();
});

test("Today has no horizontal scroll on a phone @phone", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Analytics shows GA4 traffic from the GA4 tables", async ({ page }) => {
  await page.goto("/analytics?days=28");
  const ga4 = page.locator("section", { hasText: "Website & app (GA4)" });
  await expect(ga4.getByText("GA4 property 123456789")).toBeVisible();
  // KPI tiles (some labels also head table columns, hence first()).
  for (const label of ["Sessions", "Users", "Engaged sessions", "Engagement rate", "Page and screen views"]) await expect(ga4.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(ga4.getByRole("cell", { name: "/blog/what-is-vimshottari-dasha" })).toBeVisible();
  await expect(ga4.getByRole("cell", { name: "Organic Search" })).toBeVisible();
  await page.goto("/analytics?days=90");
  await expect(page.getByText("Sessions per week (7-day blocks ending yesterday)")).toBeVisible();
  await noErrorPage(page);
});

test("Analytics has no horizontal scroll on a phone @phone", async ({ page }) => {
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

