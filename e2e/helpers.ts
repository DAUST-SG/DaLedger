import { expect, type Page } from "@playwright/test";

/** "15 000 FCFA" / "−500 FCFA" → 15000 / -500. Strips every space variant. */
export function parseAmount(text: string): number {
  const cleaned = text
    .replace(/[−–]/g, "-") // − – → -
    .replace(/[^\d-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Could not parse an amount from: "${text}"`);
  return n;
}

/** The big "Held by the SG" figure on Home. Assumes you are on Home ("/"). */
export async function readTotalHeld(page: Page): Promise<number> {
  const figure = page.locator("header .figure").first();
  await expect(figure).toBeVisible();
  return parseAmount(await figure.innerText());
}

/**
 * One cash account's balance from its Home card. Account names are the seeded
 * ones ("Cash", "Wave", "Orange Money", "Naboopay").
 * NOTE: text-based; if the card markup changes, adjust this locator (or ask the
 * frontend to add data-testid="account-<key>-balance").
 */
export async function readAccountBalance(page: Page, name: string): Promise<number> {
  const card = page
    .locator('section[aria-label="Accounts"] >> div')
    .filter({ hasText: name })
    .filter({ has: page.locator(".figure") })
    .first();
  const figure = card.locator(".figure").first();
  await expect(figure).toBeVisible();
  return parseAmount(await figure.innerText());
}

export type Entry = {
  type: "Expense" | "Income" | "Transfer" | "School allocation" | "School withdrawal" | "Adjustment ↑" | "Adjustment ↓";
  amount: number;
  account: string; // "Paid from" / "Into" / "From"
  toAccount?: string; // transfers / withdrawals
  category?: string; // income/expense only
  reason: string;
};

/**
 * Fills and submits the Add-transaction form, then waits for Home.
 * Uses the real selectors from src/routes/AddTransaction.tsx.
 */
export async function addTransaction(page: Page, e: Entry): Promise<void> {
  await page.goto("/add");
  await expect(page.getByRole("heading", { name: "Add transaction" })).toBeVisible();

  // Type: three tabs are always shown; the rest hide behind an expander.
  const mainTabs = ["Expense", "Income", "Transfer"];
  if (!mainTabs.includes(e.type)) {
    await page.getByRole("button", { name: /School allocation, withdrawal or adjustment/i }).click();
  }
  await page.getByRole("button", { name: e.type, exact: true }).click();

  await page.locator("#amount").fill(String(e.amount));

  // Account chips live under the "Paid from" / "Into" / "From" fieldset; their
  // accessible name contains the account name. Account names don't collide with
  // type/category labels.
  await page.getByRole("button", { name: new RegExp(`\\b${escapeRe(e.account)}\\b`) }).first().click();

  if (e.toAccount) {
    // The "To" / "Will be paid into" fieldset excludes the source account.
    await page.getByRole("button", { name: new RegExp(`\\b${escapeRe(e.toAccount)}\\b`) }).first().click();
  }

  if (e.category) {
    // Recently-used categories are one-tap chips; the rest are in the #category select.
    const chip = page.getByRole("button", { name: e.category, exact: true });
    if (await chip.count()) await chip.first().click();
    else await page.locator("#category").selectOption({ label: e.category });
  }

  await page.locator("#reason").fill(e.reason);
  await page.getByRole("button", { name: /^Save/ }).click();

  // On success the form navigates back to Home.
  await expect(page).toHaveURL(/\/$|\/$/);
  await expect(page.getByText("Held by the SG")).toBeVisible();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A reason unique to this run, so tests don't clash with existing data. */
export function uniqueReason(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}
