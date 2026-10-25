import { test, expect } from "@playwright/test";

// Authorization is a closed-officer set (ADR 0023): nobody signs themselves up,
// and only an *active* officer can get in or read anything. These tests use fresh,
// logged-out contexts (the `browser` fixture), so they deliberately do NOT use the
// auto-login fixture.

test.describe("authorization", () => {
  const PROTECTED = ["/add", "/transactions", "/review", "/reconcile", "/report", "/events", "/recurring"];

  test("protected routes show the login form, not data, when logged out (ADR 0023)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    for (const path of PROTECTED) {
      await page.goto(path);
      // The whole app renders <Login/> while unauthenticated; no officer data leaks.
      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.getByText("Held by the SG")).toHaveCount(0);
    }
    await context.close();
  });

  test("a deactivated officer cannot sign in (ADR 0023)", async ({ browser }) => {
    const email = process.env.E2E_INACTIVE_EMAIL;
    const password = process.env.E2E_INACTIVE_PASSWORD;
    test.skip(!email || !password, "set E2E_INACTIVE_EMAIL + E2E_INACTIVE_PASSWORD (a seeded, then deactivated officer)");

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator('input[name="email"]').fill(email!);
    await page.locator('input[name="password"]').fill(password!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Refused: an error is shown and the officer home never appears.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Held by the SG")).toHaveCount(0);
    await context.close();
  });
});
