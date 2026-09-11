/** Caller-owned saved trading evidence. Home never refreshes a broker or dispatches an order. */
import { Router } from 'express';
import type { AppContext } from '@/app/composition/app-context';
const clip = (value: unknown, cap = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);
export function createHomeSummaryRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const oidc = (req as any).oidc, sub = oidc?.user?.sub || oidc?.user?.oid;
    if (!sub || oidc?.isAuthenticated?.() !== true) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const now = new Date();
    const read = (text: string) => ctx.pool.query({ text, values: [String(sub), now], query_timeout: 1800 } as any);
    const [orders, books] = await Promise.allSettled([
      read(`SELECT mode,
        count(*) FILTER (WHERE created_at > $2::timestamptz - interval '24 hours')::text AS day,
        count(*)::text AS five,
        count(*) FILTER (WHERE status='filled')::text AS filled
        FROM oshal_trading_orders WHERE user_sub = $1 AND created_at <= $2 AND updated_at <= $2
        AND created_at > $2::timestamptz - interval '120 hours' GROUP BY mode`),
      read(`SELECT b.book_id, b.ref, b.label, b.kind, b.enabled, d.equity::text, d.et_day::text, d.updated_at
        FROM oshal_trading_books b LEFT JOIN LATERAL (
          SELECT equity, et_day, updated_at FROM oshal_trading_daily_equity d
          WHERE d.user_sub = $1 AND d.book_id=b.book_id AND d.mode=b.kind AND d.updated_at <= $2
          AND d.et_day <= ($2::timestamptz AT TIME ZONE 'America/New_York')::date
          ORDER BY et_day DESC LIMIT 1
        ) d ON true WHERE b.user_sub = $1 AND b.created_at <= $2
        ORDER BY (b.kind='live') DESC, b.ref LIMIT 4`),
    ]);
    const metrics = ['live', 'paper'].flatMap(mode => ['day', 'five'].map(period => ({
      id: mode + '-orders-' + (period === 'day' ? '24h' : '5d'),
      label: (mode === 'live' ? 'Live' : 'Paper') + ' order records / ' + (period === 'day' ? '24h' : '5 days'),
      value: orders.status === 'fulfilled' ? String(orders.value.rows.find((r: any) => r.mode === mode)?.[period] ?? '0') : 'Unavailable',
    })));
    const items: any[] = books.status === 'fulfilled' ? books.value.rows.map((b: any) => {
      const notes = clip(`${b.kind.toUpperCase()} book ${b.label} (${b.ref}). ${b.equity === null ? 'No saved equity snapshot.' : 'Recorded equity USD ' + b.equity + ' on ET date ' + b.et_day + ', saved ' + new Date(b.updated_at).toISOString() + '.'} ${b.enabled ? 'Book enabled in saved configuration.' : 'Book disabled in saved configuration.'} This is saved evidence, not current broker state or investment advice.`, 2000);
      return { text: clip(b.label + ' · ' + b.kind, 120), detail: clip(notes), tone: 'neutral', fix: 'intelligent-trades-home',
        actions: ['review-finance', 'prepare-document', 'prepare-recap'].map(integration => ({ integration, context: { title: 'Review a saved trading book', notes } })) };
    }) : [];
    const failed = [orders, books].filter(r => r.status === 'rejected').length;
    if (failed) items.push({ text: 'Some saved trading sources cannot be checked.', tone: 'warn', fix: 'intelligent-trades-home' });
    else if (!items.length) items.push({ text: 'No saved trading books yet.', tone: 'neutral', fix: 'intelligent-trades-home' });
    items.push({ text: 'Order records count creation in rolling 24/120 hours, not fills. Paper and live remain separate. Each book retains its own snapshot date.', tone: 'neutral', fix: 'intelligent-trades-home' });
    res.status(failed === 2 ? 503 : 200).json({ metrics, tiles: metrics, items, asOf: now.toISOString(), partial: failed > 0 });
  });
  return router;
}
