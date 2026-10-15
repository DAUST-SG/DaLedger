# ADR 0029 — Intake picks a category in a fixed order: request, source default, Unlabeled

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)
- **Resolves:** PRD §9 "default category per source" (the mechanism; the values
  are pending the Treasurer)

## Context

Automatic income needs a category (ADR 0009), and the brief says each source has
a default. The brief also says a new website needs only a key and the same
payload, with no tracker code change. A backend may send a category, send one
that doesn't exist or isn't an income category, or send none.

## Decision

`/intake/income` resolves the category in this order and stops at the first that
applies:

1. **The request's `category`**, if it names an existing **income-direction**
   category other than `Unlabeled`. Intake only creates income, so an expense or
   unknown category is ignored, not rejected.
2. **The source's default**, from a small map in `convex/intake.ts`
   (`shop` → Shop sales, `dabus` → DaBus; values pending the Treasurer).
3. **`Unlabeled`**, with status `needs_review` (ADR 0006). The money still counts
   toward balances (ADR 0007) and waits in the inbox for an officer to label it.

Events have no per-source default; they stay optional and per sale. An unknown or
closed event is dropped rather than rejected, so a real sale is never refused
over a label; the unknown name is kept in the audit entry for an officer to fix.

## Consequences

- A category problem never makes a backend retry a real sale forever.
- A new source works with no code change: its sales land in the inbox until it
  sends a category or gets a default in the map.
- Future sources and intake paths (for example M5's sweep placeholders) follow
  the same order.
