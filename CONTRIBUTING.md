# Contributing — Finance Tracker

## Branch Strategy

```text
main                  # always deployable; protected; changes only via a dev → main PR
dev                   # integration branch; features merge here first
<type>/m<N>-<slug>    # milestone work   e.g. feat/m1-schema-balances, infra/m1-schema
<type>/<slug>         # non-milestone    e.g. fix/balance-transfer, chore/npm-audit
```

Branch names carry the `CONTRIBUTING` type prefix (`feat`/`fix`/`chore`/`infra`)
and, for roadmap work, the milestone (`m1`–`m7`). One PR per milestone into
`dev` (see `CLAUDE.md` §3). `main` changes only via a single `dev → main` PR at
go-live.

## Commit Convention

Conventional Commits:

```text
feat(intake): idempotent /intake/income with per-source key
fix(balances): exclude committed withdrawals from totals
chore(deps): bump convex to latest
infra(schema): enforce (source, externalId, kind) uniqueness in-mutation
docs(prd): clarify part_paid handling
```

Format: `type(scope): short imperative summary`. Keep the subject ≤ 72 chars.

## Development Workflow

1. Branch from `dev`: `git checkout dev && git pull && git checkout -b feat/my-thing`.
2. Run the backend and app locally: `npx convex dev` + `npm run dev`.
3. Make the change; keep money logic in Convex functions, never in the UI.
4. Add/adjust tests (intake idempotency, balance math, webhook verification).
5. Run checks: `npm run lint && npm run typecheck && npm test`.
6. Commit with a conventional message; push the branch.
7. Open a PR into `dev`; describe behaviour and link the roadmap task.
8. After review, squash-merge to `dev`; release merges `dev` → `main`.

## Code Standards

- **TypeScript strict** on; no `any` (use `unknown` + narrowing).
- **Validate all external input** at the boundary (intake, webhook) before use.
- **Money is integer FCFA** — never floats; format only at display via `lib/fcfa.ts`.
- **Never delete financial data** — corrections are reversals/adjustments.
- **No secrets in the client** — nothing sensitive behind a `VITE_` var; secrets live in Convex env.
- **Verify webhooks over the raw body** — never a re-serialized object.
- **Lint & format** with the repo's ESLint + Prettier config; CI must be green before merge.

## Questions

Ask in the IT Committee channel, or open a GitHub issue tagged `question`. For financial-rule clarifications (categories, School handling, fee policy), tag the Treasurer. <!-- assumed: committee uses GitHub issues + a chat channel -->
