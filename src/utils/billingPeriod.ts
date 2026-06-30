/**
 * Calculates the current billing period for an org based on the day of month
 * their org was created. e.g. created Jan 15 → billing period is 15th–15th each month.
 *
 * Phase 5 will replace this with a stripe.subscriptions.retrieve() call —
 * same { start, end } return shape, surgical swap.
 */
export function getCurrentBillingPeriod(orgCreatedAt: Date): { start: Date; end: Date } {
  const now = new Date();
  const dayOfMonth = orgCreatedAt.getDate();

  // Try this month's billing date first
  let start = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);

  if (start > now) {
    // Haven't reached this month's billing date yet — use last month's
    start = new Date(now.getFullYear(), now.getMonth() - 1, dayOfMonth);
  }

  // End = same day next month
  const end = new Date(start.getFullYear(), start.getMonth() + 1, dayOfMonth);

  return { start, end };
}
