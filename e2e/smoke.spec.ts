import { test, expect } from "./fixtures";

test.describe("smoke", () => {
  test("Home loads with balances and the Add button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /DaLedger/ })).toBeVisible();
    await expect(page.getByText("Held by the SG")).toBeVisible();
    await expect(page.locator('section[aria-label="Accounts"]')).toBeVisible();
    // The laptop sidebar (hidden on this phone viewport) also has an Add link and a
    // Sections nav, so scope to the visible one to avoid a strict-mode match of two.
    await expect(page.getByRole("link", { name: /Add transaction/i }).filter({ visible: true })).toBeVisible();
  });

  test("the main sections open", async ({ page }) => {
    const nav = page.locator('nav[aria-label="Sections"]').filter({ visible: true });
    const sections: [RegExp, RegExp][] = [
      [/Needs review/i, /\/review/],
      [/Transactions/i, /\/transactions/],
      [/Reconcile/i, /\/reconcile/],
      [/Term review/i, /\/report/],
      [/Events/i, /\/events/],
      [/Recurring/i, /\/recurring/],
    ];
    for (const [label, url] of sections) {
      await page.goto("/");
      // Wait for live balances to settle so the nav isn't re-rendered mid-click.
      await expect(page.locator('section[aria-label="Accounts"] .figure').first()).toBeVisible();
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(url);
      await expect(page.locator("main")).toContainText(/\S/);
    }
  });

  test("a wrong password is rejected", async ({ browser }) => {
    // Fresh context: no saved session.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator('input[name="email"]').fill("officer@daust.sg");
    await page.locator('input[name="password"]').fill("definitely-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Held by the SG")).toHaveCount(0);
    await context.close();
  });
});
