import { sql } from './db.js';

const CORTEX_USER_ID = process.env.CORTEX_USER_ID ?? 'daniel';

export interface MetricCounts {
  total_ingested: number;
  total_uncertain: number;
  total_certain: number;
  total_ignored: number;
  uncertain_rate: number;   // uncertain / (uncertain + certain + ignored)
  auto_filed_rate: number;  // certain / (certain + uncertain) — items that didn't need triage
}

export async function computeMetrics(sinceDate?: Date): Promise<MetricCounts> {
  const since = sinceDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // default: last 24h

  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('uncertain', 'certain', 'ignored', 'resolved', 'filed')) AS total_ingested,
      COUNT(*) FILTER (WHERE status = 'uncertain') AS total_uncertain,
      COUNT(*) FILTER (WHERE status IN ('certain', 'resolved', 'filed')) AS total_certain,
      COUNT(*) FILTER (WHERE status = 'ignored') AS total_ignored
    FROM "Item"
    WHERE user_id = ${CORTEX_USER_ID}
      AND ingested_at >= ${since.toISOString()}
  `;

  const r = rows[0] as {
    total_ingested: string;
    total_uncertain: string;
    total_certain: string;
    total_ignored: string;
  };

  const total_ingested = Number(r.total_ingested) || 0;
  const total_uncertain = Number(r.total_uncertain) || 0;
  const total_certain = Number(r.total_certain) || 0;
  const total_ignored = Number(r.total_ignored) || 0;

  const classifiedTotal = total_uncertain + total_certain + total_ignored;
  const uncertain_rate = classifiedTotal > 0 ? total_uncertain / classifiedTotal : 0;

  const labelTotal = total_uncertain + total_certain;
  const auto_filed_rate = labelTotal > 0 ? total_certain / labelTotal : 0;

  return {
    total_ingested,
    total_uncertain,
    total_certain,
    total_ignored,
    uncertain_rate,
    auto_filed_rate,
  };
}

export async function snapshotMetrics(): Promise<void> {
  const metrics = await computeMetrics();

  await sql`
    INSERT INTO "MetricSnapshot" (
      id, user_id, captured_at,
      uncertain_rate, auto_filed_rate,
      total_ingested, total_uncertain, total_certain, total_ignored
    ) VALUES (
      gen_random_uuid()::text,
      ${CORTEX_USER_ID},
      now(),
      ${metrics.uncertain_rate},
      ${metrics.auto_filed_rate},
      ${metrics.total_ingested},
      ${metrics.total_uncertain},
      ${metrics.total_certain},
      ${metrics.total_ignored}
    )
  `;
}
