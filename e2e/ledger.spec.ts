import { test, expect } from "@playwright/test";
import { addTransaction, readTotalHeld, uniqueReason } from "./helpers";

// These act on the shared dev backend with tiny amounts and assert on the change
// in the total held, which is the most stable figure on Home. They leave data
// behind (by design — reversing/cleanup would need the row UI); run them against
// a disposable dev deployment, not prod.

test.describe("ledger money flows", () => {
  test("an expense lowers the total held (ADR 0007)", async ({ page }) => {
    await page.goto("/");
    const before = await readTotalHeld(page);

    await addTransaction(page, {
      type: "Expense",
      amount: 500,
      account: "Cash",
      category: "Other expense", // a seeded expense category
      reason: uniqueReason("e2e expense"),
    });

    expect(await readTotalHeld(page)).toBe(before - 500);
  });

  test("income raises the total held", async ({ page }) => {
    await page.goto("/");
    const before = await readTotalHeld(page);

    await addTransaction(page, {
      type: "Income",
      amount: 700,
      account: "Cash",
      category: "Other income", // a seeded income category
      reason: uniqueReason("e2e income"),
    });

    expect(await readTotalHeld(page)).toBe(before + 700);
  });

  test("a transfer leaves the total held unchanged (ADR 0004)", async ({ page }) => {
    await page.goto("/");
    const before = await readTotalHeld(page);

    await addTransaction(page, {
      type: "Transfer",
      amount: 300,
      account: "Wave",
      toAccount: "Cash",
      reason: uniqueReason("e2e transfer"),
    });

    expect(await readTotalHeld(page)).toBe(before);
  });

  test("a School allocation does not change the total held (ADR 0004)", async ({ page }) => {
    await page.goto("/");
    const before = await readTotalHeld(page);

    await addTransaction(page, {
      type: "School allocation",
      amount: 1000,
      account: "School",
      reason: uniqueReason("e2e allocation"),
    });

    // Money the university *owes* the SG is never in the held total.
    expect(await readTotalHeld(page)).toBe(before);
    // And School shows as owed:
    await expect(page.getByText("Owed by the university")).toBeVisible();
  });
});
