/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reconcile bounded recorded reports through the registered exact-owner briefing transaction and existing scheduler.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import * as taskStore from '@/app/routes/jarvis-task-store';
import { getJarvisBriefingDelivery } from '@/app/routes/jarvis-briefing-delivery';
import { runWithSystemIdentity } from '@/shared/services/database/request-identity';

const SESSION = 'daily-trade-recap-recorded-reports';
const LIMIT = 50;
const ADMISSION_BUDGET_MS = 10_000;
interface ReportRow { user_sub: unknown; et_day: unknown; summary: unknown }
interface Counts { inspected: number; queued: number; deferred: number; invalid: number; budgetReached: boolean }

function recordedReport(row: ReportRow): { sub: string; day: string; summary: string } | null {
  if (typeof row.user_sub !== 'string' || !row.user_sub.trim() || row.user_sub.length > 512) return null;
  if (row.user_sub !== row.user_sub.trim() || /[\u0000-\u001f\u007f]/.test(row.user_sub)) return null;
  if (typeof row.et_day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.et_day)) return null;
  const parsed = new Date(`${row.et_day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.et_day) return null;
  if (typeof row.summary !== 'string' || !row.summary.trim()) return null;
  return { sub: row.user_sub, day: row.et_day, summary: row.summary.replace(/\s+/g, ' ').trim().slice(0, 500) };
}

async function recordedRows(ctx: AppContext, now: Date): Promise<ReportRow[]> {
  const query = {
    text: `SELECT user_sub,et_day::text,LEFT(summary,500) AS summary FROM oshal_trading_strategy_journal
      WHERE kind='report' AND source='daily-report'
        AND created_at >= $1::timestamptz - INTERVAL '72 hours' AND created_at <= $1
        AND et_day <= $1::date ORDER BY created_at DESC,id DESC LIMIT $2`,
    values: [now.toISOString(), LIMIT], query_timeout: 2_000,
  };
  const result = await runWithSystemIdentity(() => ctx.pool.query<ReportRow>(query));
  return result.rows.slice(0, LIMIT);
}

async function admitRows(rows: ReportRow[], startedAt: number): Promise<Counts> {
  const counts: Counts = { inspected: 0, queued: 0, deferred: 0, invalid: 0, budgetReached: false };
  for (const row of rows) {
    if (Date.now() - startedAt >= ADMISSION_BUDGET_MS) { counts.budgetReached = true; break; }
    counts.inspected += 1;
    const report = recordedReport(row);
    if (!report) { counts.invalid += 1; continue; }
    const hash = createHash('sha256').update(JSON.stringify([report.sub, report.day])).digest('hex');
    const title = `Trading report recorded for ${report.day}`;
    const result = `${title}. ${report.summary}\nThis records the report journal; it does not confirm email or site delivery.`;
    const accepted = await taskStore.saveCompletedBriefing(`daily-trade-recap:report:${hash}`, report.sub, SESSION, title, result);
    if (accepted) counts.queued += 1; else counts.deferred += 1;
  }
  return counts;
}

/**
 * @description Reconcile existing recorded reports without generating reports, trading or sending outward messages.
 * @param ctx - Package-bound framework context; recipient identity comes only from recorded owner fields.
 * @returns Aggregate scheduler metadata without report text or owner identifiers.
 */
export async function collectCompletedReports(ctx: AppContext): Promise<{ summary: string; state: string; counts?: Counts }> {
  const runtime = getJarvisBriefingDelivery();
  if (typeof taskStore.saveCompletedBriefing !== 'function' || !runtime) {
    return { state: 'unavailable', summary: 'Recorded-report briefings require the registered completed-briefing runtime.' };
  }
  try {
    if (!await runtime.service.isProducerSession(SESSION)) return { state: 'unavailable', summary: 'Recorded-report briefing source is not registered.' };
    const startedAt = Date.now();
    const counts = await admitRows(await recordedRows(ctx, new Date(startedAt)), startedAt);
    return { state: counts.deferred || counts.budgetReached ? 'deferred' : 'available', counts,
      summary: `Recorded reports: ${counts.inspected} inspected, ${counts.queued} queued, ${counts.deferred} deferred or already queued, ${counts.invalid} invalid; admission budget ${counts.budgetReached ? 'reached' : 'available'}.` };
  } catch {
    return { state: 'unavailable', summary: 'Recorded-report briefing collection is unavailable; a later scheduled run can retry.' };
  }
}

/**
 * @description Expose the same fixed collector under the manifest's service-authenticated route.
 * @param ctx - Package-bound context; request bodies cannot supply recipients or results.
 * @returns Router with the existing deterministic service-route entry point.
 */
export function createCompletedReportBriefingRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post('/collect', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await collectCompletedReports(ctx);
    res.status(result.state === 'unavailable' ? 503 : result.state === 'deferred' ? 202 : 200).json(result);
  });
  return router;
}
