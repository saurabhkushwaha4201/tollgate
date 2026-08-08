import { db } from '../config/db';
import { logger } from '../config/logger';

/**
 * Aggregates the previous complete hour of usage_events into usage_summaries.
 * Uses an upsert (ON CONFLICT DO UPDATE) making it safe to run multiple times
 * for the same hour — i.e., idempotent across restarts.
 *
 * In production: replace setInterval with a separate worker process or pg_cron.
 * For now, running inside the app process is the correct tradeoff.
 */
export async function runAggregation(): Promise<void> {
  await db.query(`
    INSERT INTO usage_summaries (org_id, period_start, period_end, request_count, throttle_count)
    SELECT
      ue.org_id,
      DATE_TRUNC('hour', ue.created_at)                        AS period_start,
      DATE_TRUNC('hour', ue.created_at) + INTERVAL '1 hour'   AS period_end,
      COUNT(*)                                                  AS request_count,
      COUNT(*) FILTER (WHERE ue.status_code = 429)             AS throttle_count
    FROM usage_events ue
    WHERE
      ue.created_at >= DATE_TRUNC('hour', NOW() - INTERVAL '1 hour')
      AND ue.created_at <  DATE_TRUNC('hour', NOW())
    GROUP BY ue.org_id, DATE_TRUNC('hour', ue.created_at)

    ON CONFLICT (org_id, period_start)
    DO UPDATE SET
      request_count  = EXCLUDED.request_count,
      throttle_count = EXCLUDED.throttle_count,
      updated_at     = NOW()
  `);
}

// Called once on app boot — not during tests
export function startAggregationJob(): void {
  const ONE_HOUR = 60 * 60 * 1000;

  // Run once immediately on boot to catch any missed window from previous restart
  runAggregation().catch(err => {
    // console.error('[aggregateUsage] initial run failed:', err);
    logger.error({ err, context: 'aggregateUsage' }, 'initial run failed');
  });

  setInterval(() => {
    runAggregation().catch(err => {
      // console.error('[aggregateUsage] scheduled run failed:', err);
      logger.error({ err, context: 'aggregateUsage' }, 'scheduled run failed');
    });
  }, ONE_HOUR);

  // console.log('[aggregateUsage] job started — runs every hour');
  logger.info({ context: 'aggregateUsage' }, 'job started — runs every hour');
}
