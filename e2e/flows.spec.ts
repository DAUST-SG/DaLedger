import { test, expect } from "./fixtures";
import { addTransaction, readTotalHeld, expectTotalHeld, readAccountBalance, uniqueReason } from "./helpers";

// Deeper flows that drive the real UI: reversal (row actions), the Review inbox
// (fed by a mock intake), Reconcile (adjustment), and the term Report. They run on
// the shared local backend with tiny amounts and assert on deltas, like ledger.spec.

test.describe("deeper flows", () => {
  test("a reversal restores the total held (ADR 0002)", async ({ page }) => {
    await page.goto("/");
    const before = await readTotalHeld(page);

    const reason = uniqueReason("e2e reverse me");
    await addTransaction(page, { type: "Expense", amount: 400, account: "Cash", category: "Other expense", reason });
    await expectTotalHeld(page, before - 400);

    // Open the row on Transactions, expand it, and reverse it (ADR 0002). The whole
    // row is a toggle button; the reverse control lives in the expanded panel.
    await page.goto("/transactions");
    const row = page.locator("li").filter({ hasText: reason }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button").first().click(); // expand
    await row.getByLabel("Why is this being reversed?").fill("e2e: undo the test expense");
    await row.getByRole("button", { name: "Reverse this entry" }).click();

    // The reversal is its own entry; together with the original it nets to zero.
    await page.goto("/");
    await expectTotalHeld(page, before);
  });

  test("labelling an inbox item clears it (ADR 0006)", async ({ page, request }) => {
    const siteUrl = process.env.E2E_CONVEX_SITE_URL;
    const key = process.env.E2E_INTAKE_KEY;
    const source = process.env.E2E_INTAKE_SOURCE ?? "tickets";
    test.skip(!siteUrl || !key, "set E2E_CONVEX_SITE_URL + E2E_INTAKE_KEY (a source with no default category) to run this");

    // A sale from a source with no default category arrives Unlabeled → needs_review,
    // so it lands in the inbox (ADR 0006) instead of being auto-confirmed.
    const externalId = `TKT-${Date.now().toString(36)}`;
    const reason = `e2e inbox ${externalId}`;
    const res = await request.post(`${siteUrl}/intake/income`, {
      headers: { "Content-Type": "application/json", "X-Intake-Key": key! },
      data: {
        source,
        externalId,
        amount: 2500,
        paidAt: new Date().toISOString(),
        description: reason,
        naboopayReference: `mock-${externalId}`,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).status).toBe("needs_review");

    await page.goto("/review");
    const item = page.locator("li").filter({ hasText: reason }).first();
    await expect(item).toBeVisible();
    await item.getByRole("button").first().click(); // expand the row

    // Pick a real income category and confirm — "Unlabeled" is never an option.
    await item.locator('select[id^="cat-"]').selectOption({ label: "Other income" });
    await item.getByRole("button", { name: /Save and confirm/i }).click();

    // Labelling confirms it, so it leaves the inbox.
    await expect(page.locator("li").filter({ hasText: reason })).toHaveCount(0);
  });

  test("reconcile with an adjustment matches the real figure (ADR 0001)", async ({ page }) => {
    await page.goto("/");
    const cashBefore = await readAccountBalance(page, "Cash");
    const real = cashBefore + 300; // pretend the counted cash is 300 higher than the books

    await page.goto("/reconcile");
    await page.locator("#r-account").selectOption({ label: "Cash" });
    // Wait for the computed figure to load before entering the real balance.
    await expect(page.getByText("Computed by DaLedger now")).toBeVisible();
    await page.locator("#r-real").fill(String(real));

    // A non-zero difference reveals the adjust checkbox (ticked by default) + reason.
    await expect(page.locator("#r-adjust")).toBeChecked();
    await page.locator("#r-reason").fill("e2e: counted more cash than the books show");
    await page.getByRole("button", { name: /Record check/i }).click();
    await expect(page.getByRole("status")).toContainText(/upward adjustment/i);

    // Home now shows Cash at the real figure (ADR 0001: the gap is closed by an adjustment).
    await page.goto("/");
    await expect
      .poll(async () => readAccountBalance(page, "Cash"), { timeout: 15_000 })
      .toBe(real);
  });

  test("the term report reconciles: start + lines = end", async ({ page }) => {
    await page.goto("/report");

    // Widen to everything since cutover when that preset is available; otherwise the
    // default "This month" already covers the entries these tests just created.
    const sinceCutover = page.getByRole("button", { name: "Since cutover" });
    if (await sinceCutover.count()) await sinceCutover.click();

    // reports.term returns balanced:true as an invariant; the UI shows it as a tick.
    await expect(page.getByText(/Start \+ every line = end\. Nothing unexplained\./)).toBeVisible();
  });
});
