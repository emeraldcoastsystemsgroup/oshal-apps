/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read-only pending review feed (`GET /api/trading/approvals-queue`) for `/cockpit/?screen=approvals`. Emits ONLY `{ id, category, title, summary, createdAt, openHref, openLabel, readOnly: true }` (`Open in Intelligent Trades`), logs DB query failures at ERROR with `503` instead of swallowing rejections, and never exposes inline approve or decline actions or imports any `orderAuthority` module.
 */
import type { Router, Request, Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';

export interface ApprovalsLogger {
  error: (meta: Record<string, unknown>, msg: string) => void;
}

const defaultLogger: ApprovalsLogger = {
  error(meta, msg) {
    console.error(msg, meta);
  },
};

/** Extract the authenticated person's subject without importing order-authority helpers. */
function ownerSub(req: Request): string | null {
  const anyReq = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  const sub = anyReq.oidc?.user?.sub || anyReq.oidc?.user?.oid || anyReq.oshalCallerSub;
  return sub ? String(sub) : null;
}

/**
 * @description Format caller-owned waiting portfolio reviews into strictly read-only items (`Open in Intelligent Trades` only).
 * @param recordRows - Raw rows from `oshal_trading_portfolio_records` (`kind = 'review'`).
 * @param nowMs - Current epoch timestamp in milliseconds.
 * @returns Read-only items with zero `approve` or `decline` descriptors.
 */
export function formatTradingReadOnlyApprovals(
  recordRows: Array<Record<string, unknown>>,
  nowMs = Date.now(),
): Array<Record<string, unknown>> {
  const parsed = (Array.isArray(recordRows) ? recordRows : []).map((row) => {
    try {
      const data = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
      return { ...(data as Record<string, unknown>), _id: String(row.record_id || data.id || ''), _createdAt: row.created_at || data.createdAt || null };
    } catch {
      return null;
    }
  }).filter((item): item is Record<string, unknown> & { _id: string; _createdAt: unknown } => Boolean(item && item._id));

  const approvedIds = new Set(
    parsed.filter((item) => item.status === 'research-approved' && item.reviewId).map((item) => String(item.reviewId)),
  );
  return parsed
    .filter((item) => {
      if (item.reviewId || approvedIds.has(item._id)) return false;
      if (item.status && item.status !== 'pending' && item.status !== 'ready' && item.status !== 'awaiting_approval') return false;
      const exp = item.expiresAt ? Date.parse(String(item.expiresAt)) : NaN;
      return !Number.isFinite(exp) || exp > nowMs;
    })
    .map((item) => ({
      id: item._id,
      category: 'Strategy review',
      title: String(item.strategyName || item.label || item.title || `Review ${item._id}`).slice(0, 140),
      summary: 'Waiting for review inside Intelligent Trades. Orders, strategies, and mandates are never approved from this list.',
      createdAt: item._createdAt,
      openHref: '/cockpit/?app=intelligent-trades',
      openLabel: 'Open in Intelligent Trades',
      readOnly: true,
    }));
}

/**
 * @description Register `GET /approvals-queue` on the trading router. Strictly read-only; logs DB errors at ERROR and never mutates or dispatches orders.
 * @param router - Trading Express router.
 * @param ctx - Package app context.
 * @param logger - Structured logger (`logger.error`).
 * @returns Nothing.
 */
export function registerTradingApprovalsReadRoutes(
  router: Router,
  ctx: AppContext,
  logger: ApprovalsLogger = defaultLogger,
): void {
  router.get('/approvals-queue', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const sub = ownerSub(req);
    if (!sub) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    try {
      const { rows } = await ctx.pool.query(
        'SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 50',
        [sub, 'review'],
      );
      res.json({ approvals: formatTradingReadOnlyApprovals(rows as Array<Record<string, unknown>>, Date.now()), readOnly: true });
    } catch (err) {
      logger.error({ err, sub }, 'trading approvals-queue query failed');
      res.status(503).json({ error: (err as Error)?.message || 'database unavailable' });
    }
  });
}
