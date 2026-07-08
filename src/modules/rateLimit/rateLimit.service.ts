import { randomUUID } from 'crypto';
import { redis } from '../../config/redis';
import { db } from '../../config/db';
import { RATE_LIMITS, DEFAULT_RATE_LIMIT } from '../../config/rateLimits';
import { SLIDING_WINDOW_SCRIPT } from './rateLimit.lua';
import { PlanTier, PaymentStatus } from '../../types';
import { logger } from '../../config/logger';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;   // unix timestamp (seconds)
  bypassed?: boolean;
}

// SHA of the loaded script — cached after first SCRIPT LOAD
let scriptSha: string | null = null;

async function getScriptSha(): Promise<string> {
  if (scriptSha) return scriptSha;
  scriptSha = await redis.script('LOAD', SLIDING_WINDOW_SCRIPT) as string;
  return scriptSha;
}

export async function checkRateLimit(orgId: string, planTier: PlanTier): Promise<RateLimitResult> {
  const config = RATE_LIMITS[planTier] ?? DEFAULT_RATE_LIMIT;
  const now = Date.now();
  const key = `ratelimit:${orgId}`;
  const reqId = randomUUID();

  const sha = await getScriptSha();

  let result: [number, number, number];

  try {
    result = await redis.evalsha(sha, 1, key, String(now), String(config.windowMs), String(config.requests), reqId) as [number, number, number];
  } catch (err: any) {
    if (err?.message?.includes('NOSCRIPT')) {
      // Redis was restarted, script cache flushed — reload and retry once
      scriptSha = null;
      const freshSha = await getScriptSha();
      result = await redis.evalsha(freshSha, 1, key, String(now), String(config.windowMs), String(config.requests), reqId) as [number, number, number];
    } else {
      // Redis is down or unreachable — fail open
      logger.error({ err, orgId }, 'Redis unavailable — rate limit bypassed');
      return {
        allowed: true,
        limit: 0,
        remaining: -1,       // sentinel: -1 means "unknown, Redis down"
        resetAt: 0,
        bypassed: true,      // flag for the middleware
      };
    }
  }

  const [allowed, currentCount, limit] = result;
  const resetAt = Math.ceil((now + config.windowMs) / 1000);

  return {
    allowed: allowed === 1,
    limit,
    remaining: Math.max(0, limit - currentCount),
    resetAt,
  };
}

export async function getOrgPlanTier(orgId: string): Promise<PlanTier> {
  const result = await db.query<{ plan_tier: PlanTier }>(
    'SELECT plan_tier FROM orgs WHERE id = $1',
    [orgId]
  );
  return result.rows[0]?.plan_tier ?? 'free';
}

// Fire-and-forget — Phase 4 will query this table for usage analytics
export function logRateLimitEvent(orgId: string, endpoint: string): void {
  db.query(
    'INSERT INTO rate_limit_events (org_id, endpoint) VALUES ($1, $2)',
    [orgId, endpoint]
  ).catch(err => {
    logger.error({ err, context: 'logRateLimitEvent' }, 'failed to log event');
  });
}

// Returns the org's current payment status for enforcement in the rateLimit middleware.
// Fails open to 'active' on any DB error — a billing query failure should never
// take down the API request pipeline. The column-missing case (pre-migration) is
// also handled this way.
export async function getOrgPaymentStatus(orgId: string): Promise<PaymentStatus> {
  try {
    const result = await db.query<{ payment_status: PaymentStatus }>(
      'SELECT payment_status FROM orgs WHERE id = $1',
      [orgId]
    );
    return result.rows[0]?.payment_status ?? 'active';
  } catch {
    // Fail open — don't block requests due to a billing DB error
    return 'active';
  }
}
