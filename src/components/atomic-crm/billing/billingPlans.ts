/**
 * Billing display constants (E4). These are UI copy only — the authoritative
 * numbers (entitlement, the monthly limit) live in the server's ai_entitlement()
 * function. AI is the ONLY paid surface; everything else is free forever.
 *
 * "Run at cost, not for profit": the AI tier just covers what inference costs.
 */
export const AI_PRICE_MONTHLY = "$2";
export const AI_PRICE_YEARLY = "$24";

/** Display fallback for the monthly resume auto-parse allowance, used in the
 * free-tier upsell line. The real limit for an entitled account comes back from
 * ai_entitlement() (`resumes_limit`). */
export const AI_MONTHLY_RESUME_LIMIT = 100;

/**
 * The percentage a usage meter should fill, clamped to [0, 100]. A limit of 0
 * (the free tier, which has no AI allowance) reads as an empty, calm meter
 * rather than a divide-by-zero. Extracted as a pure function so the meter's one
 * piece of arithmetic can be unit-tested without a DOM.
 */
export const usagePercent = (used: number, limit: number): number => {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  const pct = (used / limit) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return Math.round(pct);
};
