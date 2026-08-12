/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted resume-strengthening reads and bounded engine mutations from the route composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Let the caller see the profile bullets an answer actually wrote. Augmentation stays a detached child (it is an unbounded model call), so its stdout can never come back on the POST; this adds a bounded read of the durable enrichment audit tail and points the answer acknowledgement at it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Honour the package's admission contract on the changelog poll: 'busy' (global engine ceiling) now answers 429, keeping 409 for 'inflight' (this caller's own augmentation still holds the slot). Both keep the in-progress body so a poller retries instead of erroring; previously both collapsed into 409, misreporting deployment-wide saturation as the caller's own duplicate.
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
const CHANGELOG_PATH = '/api/career-hunter/strengthen/changelog';

/** Read the engine child's JSON document out of its stdout tail, or null when it printed none. */
function parseEngineJson(out: string): Record<string, unknown> | null {
  const start = out.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(out.slice(start)) as Record<string, unknown>; } catch { return null; }
}

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
  const parsed = parseEngineJson(result.out);
  if (!parsed && result.out.indexOf('{') >= 0) {
    logger.error({ userSub, tail: result.out.slice(-300) }, 'strengthen parse failed');
    res.status(500).json({ error: 'parse failed' });
    return;
  }
  res.json(parsed || { themes: [], total: 0 });
}

/**
 * Return the bounded tail of this caller's durable enrichment audit.
 *
 * `POST /strengthen/answer` hands the answer to a DETACHED child because augmentation is a model
 * call with no useful upper bound, so the bullets it writes cannot ride back on that response.
 * They are persisted (profile.augment -> enrichment_log.jsonl), and this reads them. While the
 * augmentation child still owns the caller's store slot the runner reports `inflight`, which is
 * the truthful "still running" signal a poller needs — not an error.
 */
async function changelogStrengthen(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const result = await runCareerCliAwait(ctx.pool, userSub, ['strengthen', 'changelog']);
  if (result.limitReason) {
    // 'inflight' is the poller's truthful "your augmentation still owns the slot" signal and
    // keeps the 409 duplicate-slot shape. 'busy' is the GLOBAL engine ceiling — a different
    // caller's runs — and per the package contract (career-engine-response.ts) that is 429,
    // not 409. Both bodies keep status:'in-progress' so a poller retries rather than errors.
    const status = result.limitReason === 'busy' ? 429 : 409;
    res.status(status).json({ ok: false, status: 'in-progress', entries: [] });
    return;
  }
  if (!result.ok) {
    logger.error({ err: result.err, userSub }, 'strengthen changelog failed');
    res.status(500).json({ error: 'changelog failed' });
    return;
  }
  const parsed = parseEngineJson(result.out);
  if (!parsed) {
    logger.error({ userSub, tail: result.out.slice(-300) }, 'strengthen changelog parse failed');
    res.status(500).json({ error: 'parse failed' });
    return;
  }
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  res.json({ ok: true, status: 'idle', entries });
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
  // The answer is saved synchronously by the child before it augments, but augmentation itself is
  // an unbounded model call, so this stays a detached start. `changelog` is where the caller reads
  // what the augmentation added once the store slot frees.
  res.status(202).json({ ok: true, status: 'augmenting', changelog: CHANGELOG_PATH });
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
 * @description Registers resume-strengthening list, changelog, scan, answer, and status routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to run caller-brokered engine commands.
 * @returns Nothing.
 */
export function registerCareerStrengthenRoutes(router: Router, ctx: AppContext): void {
  router.get('/strengthen', (req, res) => listStrengthen(ctx, req, res));
  router.get('/strengthen/changelog', (req, res) => changelogStrengthen(ctx, req, res));
  router.post('/strengthen/scan', (req, res) => scanStrengthen(ctx, req, res));
  router.post('/strengthen/answer', (req, res) => answerStrengthen(ctx, req, res));
  router.post('/strengthen/:key/status', (req, res) => setStrengthenStatus(ctx, req, res));
}
