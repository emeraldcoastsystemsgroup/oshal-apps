/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the corpus-only browse feed so a signed-in account without an indexed resume can still search the openings.
 */

/**
 * Corpus-only browse routes.
 *
 * `GET /jobs` answers "which of MY scored matches", and returns an empty board for an account with
 * no signals database — which is every account before its first resume upload. `GET /browse`
 * answers the other question, "what is open at all", straight off the tenant-shared corpus. It is
 * still authenticated: the corpus is this deployment's ingested data, not public.
 *
 * Nothing here is per-user, so nothing here writes. The one exception is the title index the
 * keyword search depends on, which is created once if a corpus predates it — see
 * {@link ensureBrowseIndex}.
 *
 * @module career-browse-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import { fetchBrowsePage } from './career-browse-feed';
import { callerSub, openCorpusDb } from './career-user-store';

const logger = createChildLogger({ module: 'career-browse-routes' });

/**
 * The covering index the keyword search plans against. `(active, title)` is what lets
 * `SELECT id ... WHERE active=1 AND title LIKE ?` scan title keys instead of 2GB of rows.
 * It also ships in the engine's CORPUS_SCHEMA, so a corpus built or refreshed by the Python
 * engine already has it; this exists for stores ingested before it was added.
 */
const BROWSE_INDEX = 'idx_corpus_browse';
const BROWSE_INDEX_SQL =
  `CREATE INDEX IF NOT EXISTS corpus.${BROWSE_INDEX} ON postings_corpus(active, title)`;

/** Process-local: 'ready' once seen or built, 'unavailable' once a build attempt has failed. */
let browseIndexState: 'unknown' | 'ready' | 'unavailable' = 'unknown';

/**
 * @description Resets the cached index state. Test-only seam so a guard can drive both the
 *   already-present and the must-be-built paths in one process.
 * @returns Nothing.
 */
export function resetBrowseIndexState(): void {
  browseIndexState = 'unknown';
}

/**
 * @description Makes sure the keyword search has its covering index, at most once per process and
 *   only when a keyword search is actually requested.
 *
 *   The presence check runs on the caller's read-only handle, so the common path never opens the
 *   shared corpus for writing. Only a corpus that predates the index takes the write path, and a
 *   failure there is logged and remembered rather than raised: the search still returns correct
 *   rows without the index, just by scanning, and a busy nightly ingest must not turn a browse into
 *   a 500.
 * @param db - The caller's read-only corpus handle.
 * @returns True when the index is present and the search can plan against it.
 */
export function ensureBrowseIndex(db: any): boolean {
  if (browseIndexState !== 'unknown') return browseIndexState === 'ready';
  try {
    const found = db.prepare(
      "SELECT 1 AS ok FROM corpus.sqlite_master WHERE type='index' AND name=?",
    ).get(BROWSE_INDEX) as { ok?: number } | undefined;
    if (found?.ok) { browseIndexState = 'ready'; return true; }
  } catch (err) {
    logger.warn({ err }, 'career browse index probe failed');
    browseIndexState = 'unavailable';
    return false;
  }
  const started = Date.now();
  const writable = openCorpusDb(false);
  if (!writable) { browseIndexState = 'unavailable'; return false; }
  try {
    writable.exec(BROWSE_INDEX_SQL);
    browseIndexState = 'ready';
    logger.info({ ms: Date.now() - started }, 'career browse title index created');
    return true;
  } catch (err) {
    // Correctness does not depend on this — only latency does. Say so once and move on.
    logger.warn({ err, ms: Date.now() - started }, 'career browse title index unavailable; searches will scan');
    browseIndexState = 'unavailable';
    return false;
  } finally {
    try { writable.close(); } catch (err) { logger.warn({ err }, 'career browse index handle close failed'); }
  }
}

/**
 * @description Serves one page of the corpus-only browse feed.
 * @param req - Authenticated request carrying the browse filters.
 * @param res - Response receiving the page, or `{ empty: true }` before any ingest has run.
 * @returns Nothing.
 */
function getBrowse(req: Request, res: Response): void {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const db = openCorpusDb();
  if (!db) { res.json({ jobs: [], browse: true, empty: true }); return; }
  const started = Date.now();
  const query = req.query as Record<string, unknown>;
  try {
    if (typeof query.q === 'string' && query.q.trim()) ensureBrowseIndex(db);
    const result = fetchBrowsePage(db, query);
    logger.info({
      userSub,
      searched: !!result.pooled,
      sort: query.sort || 'recent',
      per: result.per,
      page: result.page,
      rows: result.jobs.length,
      ms: Date.now() - started,
    }, 'career browse feed served');
    res.json(result);
  } catch (err) {
    logger.error({ err, userSub, ms: Date.now() - started }, 'career browse read failed');
    res.status(500).json({ error: 'read failed' });
  } finally {
    try { db.close(); } catch (err) { logger.warn({ err }, 'career browse database close failed'); }
  }
}

/**
 * @description Registers the authenticated corpus-only browse feed.
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
export function registerCareerBrowseRoutes(router: Router): void {
  router.get('/browse', getBrowse);
}
