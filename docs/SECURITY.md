# Security — Finance Tracker

| | |
|---|---|
| **Version** | 1.0 |
| **Last Updated** | 2026-10-13 |

## 1. Threat Model

### Assets to Protect
- The integrity of the **ledger** (transactions and therefore all balances).
- **Officer accounts** and their sessions.
- **Intake secret keys** (shop, DaBus) and the **Naboopay webhook secret** and **server API key** (Naboopay API v2, scope `read` only — the tracker never moves money, ADR 0026).
- The **audit log** (must be tamper-evident).
- Personal data: officer emails/names; receipt images may incidentally contain PII.

### Threat Actors
- **Opportunistic outsider** — tries the public HTTP endpoints hoping to inject fake income or read data.
- **Compromised source backend** — a leaked intake key used to post bogus or duplicate income.
- **Malicious/careless insider** — an officer altering records to hide a shortfall.
- **Network attacker** — attempts to tamper with or replay webhook payloads.

### Key Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Forged income via `/intake/income` | Medium | High | Per-source secret key; reject unknown keys (401); `(source, externalId, kind)` idempotency |
| Double-counted income (Naboopay + source) | Medium | High | One capture point (rule 4); webhook/sweep never create income, only match/flag |
| Webhook forgery/replay | Medium | Medium | HMAC-SHA256 over the **raw** body; reject on mismatch; dedupe by `order_id` |
| Insider edits hiding a shortfall | Low | High | Nothing deleted; reversals only; full audit log; weekly reconciliation surfaces gaps |
| Leaked intake/webhook secret | Low | High | Per-source keys, rotation, stored as Convex env secrets, never in frontend |
| Stolen officer session | Low | Medium | Short session lifetime; closed user set; audit log attribution |
| Receipt image leaks PII | Low | Low | Access-gated storage; officers only |

## 2. Authentication & Authorization

- **Auth method:** Convex Auth for officers (email/password or OAuth). <!-- assumed: email/password; confirm with committee -->
- **Session/token expiry:** rolling session, idle timeout ~7 days. <!-- assumed -->
- **Roles:** v1 has a single `officer` role with equal rights. `treasurer`/`president` are reserved for later (withdrawal approval, read-only members).
- **Key permission rules:**
  - Every query/mutation requires an authenticated, active officer.
  - `recordedBy` is taken from the server-side identity, never from client input.
  - Intake keys and the webhook secret are **separate** from user auth and grant no UI access.

## 3. Data Security

- **Password hashing:** handled by Convex Auth (bcrypt/scrypt-class). No plaintext passwords stored.
- **PII fields:** `users.email`, `users.name`; incidental PII in `receiptUrl` images.
- **In transit:** HTTPS/TLS enforced on all endpoints; HTTP is rejected/upgraded.
- **At rest:** encrypted by the Convex platform; receipt files in access-gated storage.
- **Money values:** integers only — no floating-point rounding risk.

## 4. Secrets Management

- **`.env` policy:** `.env.local` is git-ignored; only `.env.example` (no values) is committed.
- **Production secrets:** stored as Convex environment variables (`npx convex env set INTAKE_SOURCES shop,dabus` and one `INTAKE_KEY_<SOURCE>` per source, at least 16 characters), never shipped to the browser (no `VITE_`-prefixed secrets).
- **Rotation policy:** rotate any intake key or the webhook secret on suspected exposure or officer turnover; rotate at least once per academic year. Because keys are per-source, rotating one does not disrupt the others.
- **Incident note:** a live key shared during analysis (e.g. in chat/tickets) must be treated as exposed and rotated.

## 5. API Security

- **Input validation:** every intake field validated — `amount` a positive integer, required fields present, `source` matches the key; reject with `422 VALIDATION`.
- **Idempotency:** `(source, externalId, kind)` uniqueness makes retries safe and blocks duplicate injection.
- **Guarded transitions:** every in-place status change acts only from its expected current status and no-ops otherwise, and a target has at most one active reversal — so double-taps, retries, and concurrent officers never double-move money (ADR 0019, 0020).
- **Rate limiting:** per-key limits on intake are **deferred to the pre-go-live checklist** (not M2). A leaked intake key can post distinct fake income that idempotency does not stop; the real protections are key secrecy and rotation and reconciliation against the true Naboopay balance (fake income inflates computed vs real), and rate limiting only slows an attacker. paginated, scheduled outbound calls respect Naboopay's 100 req/60 s. The tracker's Naboopay key carries only the `read` scope; it is never given `payout`, `write` or `checkout`, so a leaked key cannot move money.
- **CORS:** the SPA origin is allow-listed for the Convex client; intake/webhook endpoints are server-to-server and not CORS-exposed to browsers.
- **Webhook verification:** compute HMAC-SHA256 over the **raw request body** (via `request.text()`), compare with a constant-time check; never verify against a re-serialized object (whitespace/key-order differences cause silent failures).

## 6. Dependency Security

- **Audit process:** `npm audit` on every install; review before release.
- **Automated updates:** Dependabot/Renovate on the repo for patch/minor bumps. <!-- assumed -->
- **CVE policy:** patch Critical/High within 7 days; Medium within 30; track Low.
- **Minimal surface:** prefer the small, audited Convex + React toolchain; avoid unnecessary packages handling money or crypto.

## 7. Incident Response

1. **Detect** — an anomaly surfaces (reconciliation gap, unexpected inbox items, failed signature spikes, or a reported leak).
2. **Contain** — revoke the affected intake key / rotate the webhook secret; disable a compromised officer account.
3. **Assess** — use the audit log to determine what changed, by whom, and when; quantify ledger impact.
4. **Notify** — inform the Treasurer and IT Committee; notify affected parties if PII was exposed.
5. **Fix** — correct the ledger with reversals/adjustments (never deletions); patch the vulnerability.
6. **Post-mortem** — document root cause and prevention; update this document and rotation schedule.
