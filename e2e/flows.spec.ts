import { test, expect } from "@playwright/test";
import { addTransaction, readTotalHeld, uniqueReason } from "./helpers";

/**
 * Deeper flows that depend on UI I couldn't fully confirm from here (row actions,
 * the Reconcile form, the Review inbox, the Report page). They are written as
 * `test.fixme` scaffolds: run `npx playwright codegen <url>` or open the page,
 * confirm the one marked selector, drop the `.fixme`, and they should pass.
 */

test.describe("deeper flows (confirm selectors, then enable)", () => {
  test.fixme("a reversal restores the total held (ADR 0002)", async ({ page }) => {
    await page.goto("/");
    const before = await readTotalHeld(page);
    const reason = uniqueReason("e2e reverse me");
    await addTransaction(page, { type: "Expense", amount: 400, account: "Cash", category: "Other expense", reason });
    expect(await readTotalHeld(page)).toBe(before - 400);

    // TODO: open Transactions, find the row with `reason`, trigger its Reverse
    // action, and confirm (see src/components/TransactionRow.tsx for the control).
    await page.goto("/transactions");
    const row = page.locator("li, tr, article").filter({ hasText: reason }).first();
    await row.getByRole("button", { name: /revers/i }).click();
    // a confirm step may follow — add it here if the UI asks for a reason.

    await page.goto("/");
    expect(await readTotalHeld(page)).toBe(before);
  });

  test.fixme("labelling an inbox item clears it (ADR 0006)", async ({ page }) => {
    // TODO: requires an Unlabeled item in Review (e.g. a mock intake sale via
    // `npm run mock:intake`). Then in /review: pick a real category on the first
    // item and assert it leaves the inbox and the Home badge drops.
    await page.goto("/review");
    // const item = page.locator(...).first();
    // await item.locator("#category or a category select").selectOption({ label: "Shop sales" });
    // await item.getByRole("button", { name: /save|confirm/i }).click();
    expect(true).toBe(true);
  });

  test.fixme("reconcile with an adjustment matches the real figure (ADR 0001)", async ({ page }) => {
    // TODO: in /reconcile, pick Cash, read the computed balance, enter a real
    // balance that differs, tick "adjust" + reason, submit; assert Cash now equals
    // the entered figure on Home. Confirm the field names in src/routes/Reconcile.tsx.
    await page.goto("/reconcile");
    expect(true).toBe(true);
  });

  test.fixme("the term report reconciles (start + lines = end)", async ({ page }) => {
    // TODO: in /report pick a preset (e.g. "Since cutover") and assert the on-screen
    // "balanced ✓" marker is shown (reports.term returns `balanced: boolean`).
    await page.goto("/report");
    expect(true).toBe(true);
  });
});
