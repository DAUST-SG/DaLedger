import { test as base, expect, type Page } from "@playwright/test";

/** Sign in with the officer credentials from e2e/.env.e2e, starting at the login form. */
export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_OFFICER_EMAIL;
  const password = process.env.E2E_OFFICER_PASSWORD;
  if (!email || !password) {
    throw new Error("Set E2E_OFFICER_EMAIL and E2E_OFFICER_PASSWORD (in e2e/.env.e2e) before running the E2E suite.");
  }
  await page.goto("/");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Held by the SG")).toBeVisible();
}

/**
 * Like Playwright's `test`, but every test logs in fresh in its own context.
 *
 * We deliberately do NOT reuse a saved storageState: Convex Auth refresh tokens
 * rotate and are single-use, so sharing one saved session across many contexts
 * trips Convex's refresh-token-reuse detection, which kills the whole session
 * chain part-way through a run and bounces later tests to the login form. A fresh
 * login per test (≈1s locally) is independent and reliable. Tests are unchanged.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };
