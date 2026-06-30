import { randomUUID } from 'crypto';
import { redis } from '../../config/redis';
import { db } from '../../config/db';
import { RATE_LIMITS, DEFAULT_RATE_LIMIT } from '../../config/rateLimits';
import { SLIDING_WINDOW_SCRIPT } from './rateLimit.lua';
import { PlanTier } from '../../types';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;   // unix timestamp (seconds)
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
      throw err;
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
    console.error('[rateLimit] failed to log event:', err);
  });
}
