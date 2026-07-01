import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  checkRateLimit,
  getOrgPlanTier,
  getOrgPaymentStatus,
  logRateLimitEvent,
} from '../modules/rateLimit/rateLimit.service';
import { recordUsageEvent } from '../modules/usage/usage.service';
import { AppError } from '../utils/error';

export async function rateLimit(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Guard: this middleware only makes sense after authenticateApiKey has run
  if (!req.org_id) {
    return next(new AppError('rateLimit middleware requires org_id — check middleware order', 500));
  }

  // Payment status check runs before rate limiting.
  // 'canceled' is a hard stop — the subscription is definitively over.
  // 'past_due' is a grace period — still serve them, but signal the client.
  const paymentStatus = await getOrgPaymentStatus(req.org_id);

  if (paymentStatus === 'canceled') {
    res.status(402).json({
      error: 'Payment Required',
      message: 'Your subscription has been canceled. Please renew to continue.',
    });
    return;
  }

  if (paymentStatus === 'past_due') {
    // Warn the client but allow the request through.
    // Blocking past_due immediately hurts conversion — give them a chance to pay.
    res.setHeader('X-Billing-Status', 'past_due');
  }

  const planTier = await getOrgPlanTier(req.org_id);
  const result = await checkRateLimit(req.org_id, planTier);

  // Always set headers — even on 429, so clients know when to retry
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', result.resetAt);

  if (!result.allowed) {
    const retryAfter = result.resetAt - Math.floor(Date.now() / 1000);
    res.setHeader('Retry-After', Math.max(1, retryAfter));

    // Log for Phase 4 usage metering — fire and forget
    logRateLimitEvent(req.org_id, req.path);

    // Record throttled event — status_code 429 is definitive here
    recordUsageEvent({
      orgId: req.org_id,
      apiKeyId: req.api_key_id,
      endpoint: req.path,
      method: req.method,
      statusCode: 429,
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      retryAfter,
    });
    return;
  }

  // Record allowed event — null status_code (controller sets the real code)
  recordUsageEvent({
    orgId: req.org_id,
    apiKeyId: req.api_key_id,
    endpoint: req.path,
    method: req.method,
    statusCode: null,
  });

  next();
}

