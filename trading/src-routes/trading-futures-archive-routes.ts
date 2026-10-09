/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose owned previews and explicitly confirmed shared-reference imports without accepting caller-supplied bars or authority.
 */
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition-root';
import { isOperatorIdentity } from '@/shared/middleware/authz';
import { createChildLogger } from '@/shared/logger';
import { previewFuturesArchive, confirmFuturesArchive, listFuturesArchiveImports } from '@/app/trading-futures-archive-import';
const logger = createChildLogger({ module: 'trading-futures-archive-routes' });
function failure(res: Response, error: unknown): void {
  logger.error({ err: error }, 'Futures archive request refused');
  const item = error as { statusCode?: number; code?: string; name?: string; message?: string };
  const status = item.code === '23505' ? 409 : item.statusCode ?? (['ZodError','TypeError','RangeError'].includes(item.name ?? '') ? 400 : 503);
  res.status(status).json({ error: item.code === '23505' ? 'another_archive_worker_is_active' :
    item.statusCode ? item.message : status === 400 ? 'invalid_archive_settings' : 'futures_archive_unavailable' });
}
/** @description Require the authenticated operator on every archive route; preserve exact caller ownership through the service.
 * @param ctx - Application services. @returns Routes mounted under the existing authenticated Trading package.
 */
export function createFuturesArchiveRoutes(ctx?: AppContext): Router {
  const router = Router();
  router.use((req: Request, res: Response, next) => {
    const sub = req.oidc?.user?.sub;
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'futures_archive_unavailable' }); return; }
    next();
  });
  router.get('/', async (req: Request, res: Response) => {
    try { res.json({ imports: await listFuturesArchiveImports(ctx!.pool, req.oidc!.user!.sub!) }); }
    catch (error) { failure(res, error); }
  });
  router.post('/preview', async (req: Request, res: Response) => {
    try { res.status(202).json({ job: await previewFuturesArchive(ctx!.pool, req.oidc!.user!.sub!, req.body) }); }
    catch (error) { failure(res, error); }
  });
  router.post('/:importId/import', async (req: Request, res: Response) => {
    try { res.status(202).json({ job: await confirmFuturesArchive(ctx!.pool, req.oidc!.user!.sub!, String(req.params.importId), req.body) }); }
    catch (error) { failure(res, error); }
  });
  return router;
}
