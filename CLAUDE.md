# CLAUDE.md — How to build DaLedger

This file is the single source of truth for **how we work** on DaLedger (the
DAUST SG Finance Tracker). It is for every contributor — human or AI agent. Read
it fully before writing any code.

The **product** decisions already live in `docs/` (see §2). This file is about
**process**: the ground rules, the environment setup, the per-phase workflow, and
the path to production.

---

## 0. Ground rules (non-negotiable)

1. **The ADRs are binding.** Every decision in `docs/adr/` (0001–0032) and every
   term in `CONTEXT.md` is law. Code must match them. If you believe a decision
   is wrong, **do not silently deviate** — raise it with Pikou and, if changed,
   write a **new superseding ADR** (next free number, e.g. `0029-…`, marking the
   old one `Superseded by 0033`). The 32 decisions were reached deliberately;
   they rot the moment someone "just tweaks" the schema.
2. **Nothing is silent, nothing is deleted, nothing moves money twice, every
   number traces back to an audited entry.** This is the spine of the whole
   design — balances, reversals, adjustments, opening positions, and reports all
   obey it. Hold the line.
3. **Money is integer FCFA.** No floats, ever. Store as **`v.number()`** with a
   runtime `Number.isInteger(amount) && amount > 0` guard at every write
   boundary (ADR 0024) — *not* `v.int64()` (bigint would clash with the `number`
   TS types).
4. **Secrets are never committed.** See `docs/SECURITY.md`.
5. **Plan → agree → build.** No milestone starts coding before Pikou approves its
   plan (§3).

---

## 1. Before you start — environment & skills

**Install these skills before implementing** — they cover the stack so you don't
re-derive platform knowledge:

| Skill | Why it's needed |
|---|---|
| **`convex`** | Umbrella/index for all Convex patterns (routes to realtime, auth, etc.). Start here for backend work. |
| **`convex-functions`** | **Core.** Queries, mutations, actions, **HTTP actions** (intake + webhook), argument validation, internal functions, runtime. The whole backend is this. |
| **`create-pull-request`** | Matches our one-PR-per-milestone workflow (§3) — commit analysis, branch handling, `gh` PR creation. |
| **`frontend-design`** | Production-grade, phone-first UI that avoids generic AI aesthetics (DAUST SG branding, IBM Plex Sans). |
| **`shadcn-ui`** | Accessible React components + forms (React Hook Form + Zod) + Tailwind theming — fast path for the entry form, tables, dialogs. |
| **`web-design-guidelines`** | Review gate: audit the UI for accessibility/UX each phase. |
| **`vercel-deploy`** | Deploy the static Vite SPA (if hosting on Vercel; Netlify equivalent otherwise). |
| **`vercel-react-best-practices`** | React performance patterns — apply the **React** guidance (it leans Next.js; we're Vite). |
| **`naboopay`** | The one external integration (**API v2** — v1 is deprecated, ADR 0026): webhooks (raw-body HMAC), transactions/payouts/accounts reads, Wave/OM, XOF. Installed per project: `curl -fsSL https://docs.naboopay.com/skills/install.sh \| NABOOPAY_SKILL_URL=https://docs.naboopay.com sh -s -- claude`. |
| **`code-review`, `verify`, `run`, `security-review`** (built-ins) | Each phase: review the diff, run the app, security-review before `main`. |

**Convex Auth** is covered via the `convex` umbrella (officer login + session
identity for `recordedBy` and the audit log).

**Then read the docs, in this order, to load full context:**

1. `README.md` — what we're building and the stack.
2. `CONTEXT.md` — the glossary. Every term here has one canonical meaning.
3. `docs/adr/` — all 32 ADRs. These are the decisions you must honour.
4. `docs/PRD.md` — product requirements & acceptance criteria.
5. `docs/ARCHITECTURE.md` — components & data flows.
6. `docs/DATABASE_SCHEMA.md` — the authoritative data model (8-status enum, the
   balance engine, indexes).
7. `docs/API_DESIGN.md` + `docs/API_CONTRACT.md` — the HTTP/function surface.
8. `docs/TECHNICAL_ROADMAP.md` + `docs/IMPLEMENTATION_ROADMAP.md` — file-level map
   and the milestone/sprint plan.
9. `docs/SECURITY.md` — secrets, auth, threat model.
10. `docs/USER_BLUEPRINT.md` — screens, journeys, edge cases.

Do not start a milestone until you can restate its ADR-backed rules from memory.

---

## 2. Branch & deployment model

Two long-lived branches, each with its **own Convex deployment**:

| Branch | Convex deployment | Data | Purpose |
|---|---|---|---|
| **`dev`** | dev deployment | **mock / test** data, test keys | Where all work lands and is validated. |
| **`main`** | prod deployment | **live / real** money data, live keys | Production. Only validated, tested code. |

- **Feature branches** are cut from `dev`, named `<type>/m<N>-<slug>` (e.g.
  `feat/m1-schema-balances`, `infra/m1-schema`) — the `CONTRIBUTING.md` type
  prefix plus the milestone. Never commit straight to `dev` or `main`.
- **Secrets are per-deployment** (Convex env vars): dev gets test intake keys and
  the Naboopay test/placeholder key; prod gets the live ones. Never in the client
  bundle, never committed (`docs/SECURITY.md`).

---

## 3. Per-milestone workflow

Work **one milestone at a time** (milestones M1–M7 in
`docs/IMPLEMENTATION_ROADMAP.md`). **Every feature branch is cut from `dev` and
PR'd back into `dev` — never `main`.** `main` only ever changes via a single
`dev → main` PR at go-live (§4). For each milestone:

1. **Plan thoroughly, then get Pikou's sign-off *before* coding.** Produce a short
   plan: what you'll build, which files, which ADRs/acceptance criteria it must
   satisfy, and how you'll test it. **Do not write code until Pikou approves the
   plan.**
2. **Implement** on a feature branch **cut from `dev`** (e.g. `git switch dev &&
   git switch -c feat/m1-schema-balances`). Never branch from `main`.
3. **Test** (see §5) — the milestone's acceptance checks in the roadmap must pass.
4. **Open a PR into `dev`** (base = `dev`, never `main`). One PR per milestone,
   scoped to that milestone so the review is tractable. Describe what was built
   and which acceptance checks pass.
5. **Pikou reviews and merges** into `dev`. Address review comments on the branch.
6. **Only after the PR is merged to `dev`** do you start the next milestone, cut
   from the updated `dev`. Never begin a new phase on top of unmerged work.

> Rule of thumb: every phase is **planned, agreed, built, tested, PR'd, reviewed,
> merged** before the next begins.

---

## 4. Path to production (dev → main)

Once **all milestones are merged to `dev`** and the app works against the dev
deployment:

1. **Live-credential testing.** Naboopay has **no sandbox** — "test" vs "live" is
   only which key you use, and both move real money. So:
   - The tracker's own logic (idempotency, duplicates, refunds→reversals,
     balance math) is tested on `dev` with a **mocked intake**.
   - The genuine Naboopay webhook/intake path is tested with **tiny real amounts
     (e.g. 100 FCFA)**, then cashed out.
   - The Naboopay **webhook URL is registered per deployment** in the dashboard —
     register the dev deployment's `…convex.site/intake/naboopay` to test, then
     switch to the prod URL at go-live.
2. **Rate-limit the intake endpoints** (Convex rate-limiter, per source key) —
   deferred from M2, required before go-live.
3. **Security review** (`/security-review` + `docs/SECURITY.md` checklist) — a
   required gate before main.
4. When everything is confirmed, **open a PR `dev → main`** for Pikou to validate.
5. On merge, `main` deploys to the **prod deployment** with **live keys and real
   data**. Confirm opening balances are set from reality (cutover, ADR 0018).

---

## 5. Testing expectations

Two areas are where a silent bug corrupts money — they are **required gates**, not
optional:

1. **The balance engine** (ADR 0007, 0016): per-account effect table, reversal
   sign flip, status gate, point-in-time `balanceAsOf`. Unit-test every type and
   status, including transfers (two legs), paid withdrawals, reversals, and
   `memo`/`draft`/`skipped`/`committed` exclusion.
2. **Idempotency & guards** (ADR 0005, 0019, 0020): same order twice → one record;
   refund keyed `(source, externalId, refund)`; double "mark paid"/"confirm
   draft" → money once; at most one active reversal.

Plus each milestone's acceptance checks in `docs/IMPLEMENTATION_ROADMAP.md`.

---

## 6. Outstanding external dependencies (not design — procurement)

These gate Naboopay-dependent work (Milestone 5) and go-live. They are not design
questions; coordinate them early:

- A **fresh Naboopay server API key** with the **`read`** scope (v2), account
  activated for production.
- **Webhook registration** of our endpoint URL (per deployment, v2 payload) in the
  dashboard under Settings → Integration → Webhooks.
- **Shop & DaBus backend changes**: create transactions with
  `fees_customer_side: true`, persist Naboopay's returned `order_id`, and call
  `/intake/income` on the transition to `paid` (ADR 0026); retry on 5xx and on 429 (after `Retry-After`), and treat a
  refund `404` as **retryable** (ADR 0005, amended).
- **Verified opening balances** + a university statement for the School receivable.
- A **small test budget** (real FCFA) for live testing.

(Full list: the feasibility report's "what we need from your side".)
