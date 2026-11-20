import { expect, test } from "@playwright/test";

/**
 * Two tenants, over HTTP, through the whole application. Skipped unless a second tenant
 * exists: provision one with
 *   pnpm --filter @bodh/db provision -- --slug acme --name "Acme Ltd" --admin admin@acme.test
 *
 * These assert the thing that matters most: one tenant's page never shows another's rows.
 */
const SECOND = process.env.E2E_SECOND_TENANT ?? "acme";

test.describe("tenant isolation over HTTP", () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`/t/${SECOND}/admin`);
    test.skip(!res || res.status() >= 400, `no second tenant "${SECOND}" provisioned`);
  });

  test("each tenant's Admin lists only its own people", async ({ page }) => {
    // toContainText retries, so this waits for the people table rather than racing the stream.
    await page.goto("/admin");
    await expect(page.locator("main")).toContainText("ads@rechargestudio.com");

    await page.goto(`/t/${SECOND}/admin`);
    await expect(page.locator("main")).toContainText("admin@acme.test");
    for (const leaked of ["ads@rechargestudio.com", "seo@rechargestudio.com", "social@rechargestudio.com"]) {
      await expect(page.locator("main")).not.toContainText(leaked);
    }
  });

  test("the sidebar names the tenant you are in", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("aside")).toContainText(/Bodhlok/i);

    await page.goto(`/t/${SECOND}/`);
    await expect(page.locator("aside")).not.toContainText(/Bodhlok/i);
  });

  test("content written in one tenant never appears in the other", async ({ page }) => {
    // A calendar item that exists only in the second tenant.
    const marker = process.env.E2E_SECOND_TENANT_MARKER ?? "ACME ONLY";

    await page.goto(`/t/${SECOND}/calendar`);
    const second = await page.locator("body").innerText();
    test.skip(!second.includes(marker), `the second tenant has no "${marker}" calendar item to check`);

    await page.goto("/calendar");
    expect(await page.locator("body").innerText()).not.toContain(marker);
  });

  test("an unknown tenant slug is refused, not served as tenant #1", async ({ page }) => {
    const res = await page.goto("/t/not-a-tenant/admin");
    expect(res?.status()).toBe(404);
    expect(await page.locator("body").innerText()).not.toContain("ads@rechargestudio.com");
  });

  test("one tenant's row id is not readable from the other tenant's address", async ({ page, request }) => {
    // Guessing an id must not be enough: the row simply is not in the other tenant's schema.
    await page.goto("/calendar");
    const href = await page.locator('a[href*="/calendar/"]').first().getAttribute("href");
    const id = href?.match(/\/calendar\/([0-9a-f-]{36})/)?.[1];
    test.skip(!id, "tenant #1 has no calendar item to probe with");

    await page.goto(`/calendar/${id}`);
    const title = (await page.locator("h1").first().innerText()).trim();
    expect(title.length).toBeGreaterThan(8);

    // Over HTTP: Next streams a refused page as 200, so what came back is the assertion, and
    // what must not be in it is this tenant #1 item's own heading.
    const theirs = await (await request.get(`/t/${SECOND}/calendar/${id}`)).text();
    expect(theirs).not.toContain(title);
  });
});
