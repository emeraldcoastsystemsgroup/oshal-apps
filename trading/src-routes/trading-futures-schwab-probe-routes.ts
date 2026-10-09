/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose an operator-only, owner-token Schwab Futures bar capability check without market-data payloads or writes.
 */
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition-root';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { probeSchwabFuturesBars } from '@/app/trading-futures-schwab-probe';
import { isOperatorIdentity } from '@/shared/middleware/authz';

/** @description Read-only owner-bound check; never accepts a caller-supplied bearer or account identity. */
export function createFuturesSchwabProbeRoutes(ctx?: AppContext): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const sub = req.oidc?.user?.sub;
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'schwab_probe_unavailable' }); return; }
    try {
      const token = await getValidAccessToken(ctx.pool, sub, 'schwab');
      if (!token) { res.status(409).json({ error: 'schwab_connection_not_available' }); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await probeSchwabFuturesBars(token));
    } catch {
      res.status(503).json({ error: 'schwab_probe_unavailable' });
    }
  });
  return router;
}
