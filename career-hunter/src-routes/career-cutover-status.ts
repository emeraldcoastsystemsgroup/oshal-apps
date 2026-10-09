/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Serve the PostgreSQL cutover observation window to operators: GET /status reads the archive engine/sync/observe_cutover.py writes (window.json + latest.json) and returns the window, the latest sample's signals and its violations. Anonymous callers get 401 and signed-in non-operators 403 before any file is read; nothing is written, queried or cached.
 */

/**
 * Career storage-cutover observation status (BACKEND-CUTOVER.md, "Seven-day observation").
 * @module career-cutover-status
 */
import { Router, type Request, type Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { createChildLogger } from '@/shared/logger';
import { isOperator } from '@/shared/middleware/authz';
import { corpusDbPath } from './career-user-store';

const logger = createChildLogger({ module: 'career-cutover-status' });

/** The fields of one observation sample this route serves; per-owner detail stays in the archive. */
interface PublicSample {
  sampledAt: unknown; inBounds: unknown; violations: unknown; nightly: unknown;
  convergence: unknown; reverseSync: unknown; rls: unknown; activity: unknown; archivedReport: unknown;
}

/**
 * @description Where the observer archives its samples: CAREER_CUTOVER_ARCHIVE_DIR, or `_cutover`
 * beside the tenant's corpus.db (the observer's own default of `<data-root>/_cutover`). The leading
 * underscore keeps the loader, reporter, projector and cron from ever treating it as a user store.
 * @returns The absolute archive directory.
 */
export function cutoverArchiveDir(): string {
  const configured = (process.env.CAREER_CUTOVER_ARCHIVE_DIR || '').trim();
  return configured ? path.resolve(configured) : path.join(path.dirname(corpusDbPath()), '_cutover');
}

/** Read one archive JSON file; an absent file is "not observed yet", anything else is an error. */
async function readArchiveJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * @description Reduce a stored sample to what an operator needs on a status page. The owner-isolation
 * probe's per-owner breakdown is dropped (its totals remain); convergence failures are already
 * labelled with hashed owner ids by the observer.
 * @param sample - One sample exactly as observe_cutover.py stored it.
 * @returns The served subset.
 */
export function publicSample(sample: Record<string, unknown>): PublicSample {
  const rls = (sample.rls ?? {}) as Record<string, unknown>;
  return {
    sampledAt: sample.sampledAt, inBounds: sample.inBounds, violations: sample.violations,
    nightly: sample.nightly, convergence: sample.convergence, reverseSync: sample.reverseSync,
    rls: { probedOwners: rls.probedOwners, foreignRowsVisible: rls.foreignRowsVisible, ok: rls.ok },
    activity: sample.activity, archivedReport: sample.archivedReport,
  };
}

/** Refuse anonymous and non-operator callers before touching the archive. */
function refuse(req: Request, res: Response): boolean {
  const oidc = (req as unknown as { oidc?: { user?: { sub?: string }; isAuthenticated?: () => boolean } }).oidc;
  if (!oidc?.user?.sub || oidc.isAuthenticated?.() !== true) {
    res.status(401).json({ error: 'not_authenticated' });
    return true;
  }
  if (!isOperator(req)) {
    res.status(403).json({ error: 'Operator access required' });
    return true;
  }
  return false;
}

/** GET /status — the observation window and the latest sample. */
async function handleStatus(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (refuse(req, res)) return;
  const started = Date.now();
  logger.info({ route: 'GET /status' }, 'career cutover status requested');
  try {
    const archive = cutoverArchiveDir();
    const [window, latest] = await Promise.all([
      readArchiveJson(path.join(archive, 'window.json')),
      readArchiveJson(path.join(archive, 'latest.json')),
    ]);
    if (!window || !latest) {
      res.json({ schemaVersion: 1, state: 'not-started', window: null, latest: null });
    } else {
      res.json({ schemaVersion: 1, state: window.complete ? 'complete' : 'observing', window,
        latest: publicSample(latest) });
    }
    logger.info({ route: 'GET /status', durationMs: Date.now() - started }, 'career cutover status served');
  } catch (err) {
    logger.error({ err, route: 'GET /status' }, 'career cutover archive unreadable');
    res.status(500).json({ error: 'cutover_archive_unreadable' });
  }
}

/**
 * @description Factory for the operator-only cutover status route, mounted at
 * /api/career-hunter/cutover with `auth: oidc`.
 * @param _ctx - Kernel app context (unused: the route reads only the observer's archive).
 * @returns The Express router.
 */
export function createCareerCutoverStatusRoutes(_ctx: unknown): Router {
  const router = Router();
  router.get('/status', (req, res) => { void handleStatus(req, res); });
  return router;
}
