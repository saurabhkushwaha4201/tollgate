import { PlanTier } from '../types';

interface RateLimitConfig {
  requests: number;   // max requests per window
  windowMs: number;   // window size in milliseconds
}

export const RATE_LIMITS: Record<PlanTier, RateLimitConfig> = {
  free:       { requests: 60,   windowMs: 60_000 },   // 1 req/sec sustained
  pro:        { requests: 600,  windowMs: 60_000 },   // 10 req/sec sustained
  enterprise: { requests: 6000, windowMs: 60_000 },   // 100 req/sec sustained
};

// Fallback if org plan isn't in the map (shouldn't happen, but defensive)
export const DEFAULT_RATE_LIMIT: RateLimitConfig = RATE_LIMITS.free;
