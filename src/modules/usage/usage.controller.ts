import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/db';
import { getCurrentBillingPeriod } from '../../utils/billingPeriod';
import { RATE_LIMITS, DEFAULT_RATE_LIMIT } from '../../config/rateLimits';
import {
  getCurrentPeriodUsage,
  getUsageHistory as fetchUsageHistory,
  getRecentHourlyBreakdown,
} from './usage.service';
import { PlanTier } from '../../types';

export async function getUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.params.orgId as string;

    const orgRes = await db.query<{ plan_tier: PlanTier; created_at: Date }>(
      'SELECT plan_tier, created_at FROM orgs WHERE id = $1',
      [orgId]
    );

    if (orgRes.rows.length === 0) {
      res.status(404).json({ error: 'Org not found' });
      return;
    }

    const org = orgRes.rows[0];
    const billingPeriod = getCurrentBillingPeriod(org.created_at);
    const rateLimitConfig = RATE_LIMITS[org.plan_tier] ?? DEFAULT_RATE_LIMIT;

    const [usage, hourlyBreakdown] = await Promise.all([
      getCurrentPeriodUsage(orgId, billingPeriod.start),
      getRecentHourlyBreakdown(orgId),
    ]);

    res.json({
      data: {
        org_id: orgId,
        plan_tier: org.plan_tier,
        billing_period: {
          start: billingPeriod.start.toISOString(),
          end: billingPeriod.end.toISOString(),
        },
        current_usage: {
          request_count: usage.request_count,
          throttle_count: usage.throttle_count,
          limit: rateLimitConfig.requests,
          window: 'per minute',
        },
        hourly_breakdown: hourlyBreakdown.map(h => ({
          hour: h.period_start,
          requests: h.request_count,
          throttles: h.throttle_count,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getUsageHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.params.orgId as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));

    const { rows, total } = await fetchUsageHistory(orgId, page, limit);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}
