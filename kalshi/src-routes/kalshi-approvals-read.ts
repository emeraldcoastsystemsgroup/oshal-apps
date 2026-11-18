/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read-only confirm-gated order queue (`GET /api/kalshi/approvals-queue`) for `/cockpit/?screen=approvals`. Emits ONLY `blocked` `kalshi_orders` rows (`Open in Kalshi`, `readOnly: true`, zero `approve`/`decline` fields) and logs query failures at ERROR instead of swallowing rejections.
 */
import type { Router, Request, Response } from 'express';
import type { Pool } from 'pg';

export interface ApprovalsLogger {
  error: (meta: Record<string, unknown>, msg: string) => void;
}

const defaultLogger: ApprovalsLogger = {
  error(meta, msg) {
    console.error(msg, meta);
  },
};

/** Resolve the authenticated caller's subject without importing order-placement helpers. */
function ownerSub(req: Request): string | null {
  const anyReq = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  const sub = anyReq.oidc?.user?.sub || anyReq.oidc?.user?.oid || anyReq.oshalCallerSub;
  return sub ? String(sub) : null;
}

/**
 * @description Format caller-owned `blocked` `kalshi_orders` rows into strictly read-only items (`Open in Kalshi` only). Live `resting`/`open`/`pending` exchange orders are excluded.
 * @param orderRows - Raw rows from `kalshi_orders`.
 * @returns Read-only items with zero `approve` or `decline` descriptors.
 */
export function formatKalshiReadOnlyApprovals(
  orderRows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return (Array.isArray(orderRows) ? orderRows : [])
    .filter((row) => row && String(row.kalshi_status || '').toLowerCase() === 'blocked')
    .map((row, idx) => {
      const id = String(row.kalshi_order_id || row.client_order_id || row.id || idx);
      const ticker = String(row.ticker || 'KALSHI').slice(0, 64);
      const action = String(row.action || 'buy').toUpperCase();
      const side = String(row.side || 'yes').toUpperCase();
      const count = Number(row.count || 0);
      const cents = Number(row.limit_price_cents || 0);
      const env = String(row.env || 'live').toLowerCase();
      const detail = row.error
        ? String(row.error).slice(0, 180)
        : `Confirm-gated ${env} order blocked pending review inside Kalshi.`;
      return {
        id,
        category: 'Kalshi order',
        title: `${ticker} · ${action} ${side} x${count} @ ${cents}c`.slice(0, 140),
        summary: detail,
        createdAt: row.created_at || null,
        openHref: '/cockpit/?app=kalshi',
        openLabel: 'Open in Kalshi',
        readOnly: true,
      };
    });
}

/**
 * @description Register `GET /approvals-queue` on the Kalshi router. Strictly read-only; logs DB errors at ERROR and never mutates or dispatches orders.
 * @param router - Kalshi Express router.
 * @param pool - PostgreSQL pool.
 * @param logger - Structured logger (`log.error`).
 * @returns Nothing.
 */
export function registerKalshiApprovalsReadRoutes(
  router: Router,
  pool: Pool,
  logger: ApprovalsLogger = defaultLogger,
): void {
  router.get('/approvals-queue', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const sub = ownerSub(req);
    if (!sub) {
      res.status(401).json({ error: 'authentication required' });
      return;
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, env, ticker, side, action, count, limit_price_cents, client_order_id, kalshi_order_id, kalshi_status, error, created_at
         FROM kalshi_orders
         WHERE user_sub = $1 AND kalshi_status = 'blocked'
         ORDER BY created_at DESC LIMIT 50`,
        [sub],
      );
      res.json({ approvals: formatKalshiReadOnlyApprovals(rows as Array<Record<string, unknown>>), readOnly: true });
    } catch (err) {
      logger.error({ err, sub }, 'kalshi approvals-queue query failed');
      res.status(503).json({ error: (err as Error)?.message || 'database unavailable' });
    }
  });
}
