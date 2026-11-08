/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | Codex | Expose the caller's previously saved digest on Home without mailbox reads or generation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Open the digest through the kernel's seal; a summary only the earlier platform could open reads as not saved.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Surface active mailbox watches (such as TotalConnect Security Monitor) on Home with monitored account, last check time and latest alert summary, falling back cleanly when migration 005 has not run yet.
 */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { openDigest } from './digest-seal';

function missingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42P01' || /does not exist|unknown table|no such table|undefined table/i.test(String(e?.message || ''));
}

function appendWatchSummary(metrics: any[], items: any[], watchRows: any[], nowMs: number): void {
  const active = watchRows
    .filter((w) => typeof w?.watch_id === 'string' && w.watch_id.length > 0 && (w.enabled === true || w.enabled === 1))
    .sort((a, b) => Date.parse(String(b.updated_at || '')) - Date.parse(String(a.updated_at || '')));
  if (active.length === 0) return;
  const totalHits = active.reduce((sum, w) => sum + Math.max(0, Number(w.hit_count) || 0), 0);
  metrics.push({
    id: 'mailbox-watches',
    label: 'Mailbox watches',
    value: totalHits > 0 ? `Active (${totalHits})` : 'Active',
    tone: totalHits > 0 ? 'warn' : 'ok',
  });
  for (const w of active.slice(0, 5)) {
    const label = String(w.label || w.watch_id).trim();
    const account = String(w.account_hint || '').trim();
    const checkedMs = w.last_checked_at ? new Date(w.last_checked_at).getTime() : NaN;
    const checkedText = Number.isFinite(checkedMs) && checkedMs <= nowMs
      ? `checked ${Math.max(0, Math.floor((nowMs - checkedMs) / 60000))}m ago`
      : 'awaiting first check';
    const summary = String(w.last_hit_summary || '').trim();
    items.push({
      metricId: 'mailbox-watches',
      text: `${label}${account ? ` (${account})` : ''} — ${checkedText}`.slice(0, 120),
      detail: summary ? `Latest alert: ${summary}`.slice(0, 400) : 'No matching alerts recorded yet.',
      tone: Number(w.hit_count) > 0 && summary ? 'warn' : 'neutral',
      fix: 'email-inbox',
    });
  }
}

/** @description Read a bounded cached digest and active mailbox watches in the caller's session. @param ctx Package context. @returns Summary router. */
export function createHomeSummaryRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const oidc = (req as any).oidc;
    const sub = oidc?.user?.sub || oidc?.user?.oid;
    if (!sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const row = (await ctx.pool.query('SELECT summary, updated_at FROM oshal_email_digests WHERE user_sub = $1', [String(sub)])).rows[0];
      let watchRows: any[] = [];
      try {
        watchRows = (await ctx.pool.query(
          'SELECT watch_id, label, account_hint, enabled, last_checked_at, last_hit_at, last_hit_summary, hit_count, updated_at FROM oshal_email_watches WHERE user_sub = $1',
          [String(sub)],
        )).rows;
      } catch (err) {
        if (!missingTable(err)) throw err;
      }
      const summary = row?.summary ? ((await openDigest(String(sub), row.summary)) ?? '').replace(/\s+/g, ' ').trim() : '';
      const now = new Date();
      const at = summary && row?.updated_at ? new Date(row.updated_at).getTime() : NaN;
      const validTime = Number.isFinite(at) && at <= now.getTime();
      const metrics: any[] = [
        { id: 'cached-digest', label: 'Saved email digest', value: summary ? 'Available' : 'Not saved', tone: 'neutral' },
        { id: 'digest-age', label: 'Digest generated', value: validTime ? `${Math.floor((now.getTime() - at) / 60000)}m ago` : summary ? 'Unknown' : 'Not recorded', tone: 'neutral' },
      ];
      const items: any[] = [
        { metricId: 'cached-digest', text: summary ? summary.slice(0, 120) : 'No digest saved. Open My Day to generate one from your connected mailbox.', detail: summary.slice(120, 520), tone: 'neutral', fix: 'email-myday',
          actions: summary ? ['prepare-document', 'review-sales'].map(integration => ({ integration, context: { title: 'Review my saved email digest', notes: summary.slice(0, 2000) } })) : [] },
        { metricId: 'digest-age', text: validTime ? `Saved ${new Date(at).toISOString()}; this is generation time, not current inbox freshness.` : 'Cached digest only; unread counts and current inbox freshness are not available here.', tone: 'neutral', fix: 'email-myday' },
      ];
      appendWatchSummary(metrics, items, watchRows, now.getTime());
      res.json({ tiles: metrics, metrics, items, asOf: now.toISOString(), generatedAt: validTime ? new Date(at).toISOString() : null });
    } catch {
      res.status(503).json({ error: 'The saved email digest cannot be read.' });
    }
  });
  return router;
}
