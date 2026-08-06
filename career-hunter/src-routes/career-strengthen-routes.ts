/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted resume-strengthening reads and bounded engine mutations from the route composition root.
 */

/**
 * Resume gap-theme and profile-strengthening routes.
 * @module career-strengthen-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub } from './career-user-store';
import { runCareerCliAsync, runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineStart } from './career-engine-response';

const logger = createChildLogger({ module: 'career-strengthen-routes' });

async function listStrengthen(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const result = await runCareerCliAwait(ctx.pool, userSub, ['strengthen', 'list']);
  if (result.limitReason) {
    rejectEngineStart(
      res, { started: false, limitReason: result.limitReason }, 'strengthen list',
    );
    return;
  }
  if (!result.ok) {
    logger.error({ err: result.err, userSub }, 'strengthen list failed');
    res.status(500).json({ error: 'list failed' });
    return;
  }
  try {
    const start = result.out.indexOf('{');
    res.json(start >= 0 ? JSON.parse(result.out.slice(start)) : { themes: [], total: 0 });
  } catch (err) {
    logger.error({ err, userSub, tail: result.out.slice(-300) }, 'strengthen parse failed');
    res.status(500).json({ error: 'parse failed' });
  }
}

async function scanStrengthen(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const started = await runCareerCliAsync(ctx.pool, userSub, ['strengthen', 'scan']);
  if (rejectEngineStart(res, started, 'strengthen scan')) return;
  res.status(202).json({ ok: true, status: 'scanning' });
}

async function answerStrengthen(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const key = String(req.body?.key || '').trim();
  const response = String(req.body?.response || '').trim();
  if (!key || !response) { res.status(400).json({ error: 'key + response required' }); return; }
  const started = await runCareerCliAsync(ctx.pool, userSub, ['strengthen', 'answer'], {
    CH_KEY: key,
    CH_RESP: response,
  });
  if (rejectEngineStart(res, started, 'strengthen answer')) return;
  res.status(202).json({ ok: true, status: 'augmenting' });
}

async function setStrengthenStatus(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const key = String(req.params.key || '').trim();
  const status = String(req.body?.status || '').trim();
  if (!key || !['open', 'skipped', 'answered'].includes(status)) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  const result = await runCareerCliAwait(ctx.pool, userSub, ['strengthen', 'status'], {
    CH_KEY: key,
    CH_STATUS: status,
  });
  if (result.limitReason) {
    rejectEngineStart(
      res, { started: false, limitReason: result.limitReason }, 'strengthen status',
    );
    return;
  }
  res.json({ ok: result.ok });
}

/**
 * @description Registers resume-strengthening list, scan, answer, and status routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to run caller-brokered engine commands.
 * @returns Nothing.
 */
export function registerCareerStrengthenRoutes(router: Router, ctx: AppContext): void {
  router.get('/strengthen', (req, res) => listStrengthen(ctx, req, res));
  router.post('/strengthen/scan', (req, res) => scanStrengthen(ctx, req, res));
  router.post('/strengthen/answer', (req, res) => answerStrengthen(ctx, req, res));
  router.post('/strengthen/:key/status', (req, res) => setStrengthenStatus(ctx, req, res));
}
