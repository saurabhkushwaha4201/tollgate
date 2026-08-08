import { db } from '../../config/db';
import { logger } from '../../config/logger';

export interface UsageEventInput {
  orgId: string;
  apiKeyId: string | undefined;
  endpoint: string;
  method: string;
  statusCode: number | null;   // null = allowed (real status set by controller); 429 = throttled
}

// Fire-and-forget — never awaited, must not affect request latency
export function recordUsageEvent(input: UsageEventInput): void {
  db.query(
    `INSERT INTO usage_events (org_id, api_key_id, endpoint, method, status_code)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.orgId, input.apiKeyId ?? null, input.endpoint, input.method, input.statusCode]
  ).catch(err => {
    // console.error('[usage] failed to record usage event:', err);
    logger.error({ err, context: 'recordUsageEvent' }, 'failed to record usage event');
  });
}

export interface PeriodUsage {
  request_count: number;
  throttle_count: number;
}

// Reads from usage_summaries (not raw events) — fast aggregation for billing
export async function getCurrentPeriodUsage(orgId: string, billingStart: Date): Promise<PeriodUsage> {
  const result = await db.query<{ request_count: string; throttle_count: string }>(
    `SELECT
       COALESCE(SUM(request_count), 0)  AS request_count,
       COALESCE(SUM(throttle_count), 0) AS throttle_count
     FROM usage_summaries
     WHERE org_id = $1
       AND period_start >= $2`,
    [orgId, billingStart]
  );

  return {
    request_count: parseInt(result.rows[0].request_count, 10),
    throttle_count: parseInt(result.rows[0].throttle_count, 10),
  };
}

export interface HourlySummary {
  period_start: string;
  period_end: string;
  request_count: number;
  throttle_count: number;
}

// Paginated hourly breakdown — for /usage/history endpoint
export async function getUsageHistory(
  orgId: string,
  page: number,
  limit: number
): Promise<{ rows: HourlySummary[]; total: number }> {
  const offset = (page - 1) * limit;

  const [dataRes, countRes] = await Promise.all([
    db.query<HourlySummary>(
      `SELECT period_start, period_end, request_count, throttle_count
       FROM usage_summaries
       WHERE org_id = $1
       ORDER BY period_start DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    ),
    db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM usage_summaries WHERE org_id = $1`,
      [orgId]
    ),
  ]);

  return {
    rows: dataRes.rows,
    total: parseInt(countRes.rows[0].total, 10),
  };
}

// Last 24 hours breakdown — embedded in /usage response
export async function getRecentHourlyBreakdown(orgId: string): Promise<HourlySummary[]> {
  const result = await db.query<HourlySummary>(
    `SELECT period_start, period_end, request_count, throttle_count
     FROM usage_summaries
     WHERE org_id = $1
       AND period_start >= NOW() - INTERVAL '24 hours'
     ORDER BY period_start DESC`,
    [orgId]
  );
  return result.rows;
}
