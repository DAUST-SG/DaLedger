# End-to-end tests (Playwright)

Browser tests that drive the deployed SPA like a real officer: log in, add
entries, and check that balances move the way the ledger rules say. They run
against a **live deployment**, so point them at a **disposable dev deployment**
(they leave data behind), never prod.

## One-time setup

```bash
npm install                 # installs @playwright/test
npx playwright install chromium
cp e2e/.env.e2e.example e2e/.env.e2e
# edit e2e/.env.e2e: set E2E_BASE_URL and a throwaway officer's E2E_OFFICER_EMAIL / _PASSWORD
```

Credentials live in `e2e/.env.e2e` (git-ignored), so they never touch the
command line or shell history. Rotate the test officer's password afterwards.

## Run

```bash
npm run e2e            # headless, all specs
npm run e2e:ui         # Playwright's interactive UI (great for debugging selectors)
npm run e2e:report     # open the last HTML report
```

## What's covered

- **`auth.setup.ts`** — logs in once, saves the session for the rest.
- **`smoke.spec.ts`** — Home loads, every section opens, a wrong password is rejected.
- **`ledger.spec.ts`** — the money rules through the UI: an expense lowers the
  total held, income raises it, a transfer leaves it unchanged, a School
  allocation never touches the held total.
- **`flows.spec.ts`** — deeper flows (reversal, labelling an inbox item,
  reconcile + adjustment, the report's balanced check) as **`test.fixme`
  scaffolds**: confirm the one marked selector in each (the markup wasn't visible
  when these were written), remove `.fixme`, and enable them.

## Notes

- Tests run **serially** (`workers: 1`) because they share one live backend, and
  each asserts on a **change** (read a balance → act → re-read), not an absolute
  figure — so existing data doesn't break them.
- Finding a selector: `npx playwright codegen https://daledger-dev.vercel.app`
  records clicks and shows the locators it would use.
- If the UI markup shifts, the few text-based locators are flagged with comments
  in `helpers.ts`; the most robust fix is to add `data-testid` attributes in the
  frontend (e.g. `data-testid="account-cash-balance"`).
- The real **Naboopay** webhook/sweep path is **not** covered here — it needs the
  registered webhook + a tiny real payment and is a separate go-live step.
