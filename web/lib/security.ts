import { timingSafeEqual } from "node:crypto";

export function hasValidBearerToken(authorization: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!authorization || !secret || !authorization.startsWith("Bearer ")) return false;

  const actual = new TextEncoder().encode(authorization.slice("Bearer ".length));
  const expected = new TextEncoder().encode(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function internalFailurePayload(runId: string) {
  return { ok: false, runId, error: "Internal server error" };
}
