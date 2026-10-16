import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/officer.json";

/**
 * Signs in once with the officer credentials from the environment and saves the
 * session, so the feature specs don't each log in. Set the credentials in
 * e2e/.env.e2e (git-ignored) — never on the command line.
 */
setup("authenticate as an officer", async ({ page }) => {
  const email = process.env.E2E_OFFICER_EMAIL;
  const password = process.env.E2E_OFFICER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set E2E_OFFICER_EMAIL and E2E_OFFICER_PASSWORD (in e2e/.env.e2e or your environment) before running the E2E suite.",
    );
  }

  await page.goto("/");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Home proves the session is live.
  await expect(page.getByText("Held by the SG")).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
