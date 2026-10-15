/**
 * Intake keys live in Convex env vars (SECURITY.md §4): INTAKE_SOURCES lists the
 * sources ("shop,dabus"), and INTAKE_KEY_<SOURCE> holds each one's secret.
 * Convex cannot list env vars, hence the explicit INTAKE_SOURCES. A new website
 * needs two env var changes and no code change (brief §6).
 */
export function sourceForKey(presented: string | null): string | null {
  if (!presented) return null;
  const sources = (process.env.INTAKE_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let match: string | null = null;
  // Compare against every key, so timing does not reveal which one is close.
  for (const source of sources) {
    const secret = process.env[`INTAKE_KEY_${source.toUpperCase()}`];
    if (secret && secret.length >= 16 && safeEqual(presented, secret)) match = source;
  }
  return match;
}

/** Constant-time string comparison (no node:crypto in the Convex runtime). */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
