import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

/**
 * Intake rate limits (CLAUDE.md §4, SECURITY.md). They slow a leaked key; key
 * rotation and reconciliation against the real Naboopay balance remain the real
 * defence. A request over a limit is answered 429 and writes nothing.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Per source (shop, dabus), shared by sales and refunds. Bursts cover a ticket rush.
  intake: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 120 },
  // All Naboopay webhook calls, after the signature check. Bursty on settlement.
  naboopayWebhook: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 240 },
  // One shared cap on requests with a bad intake key or webhook signature.
  rejected: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 60 },
});
