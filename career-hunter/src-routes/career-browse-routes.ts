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
const BROWSE_INDEXES = [
  {
    name: 'idx_corpus_browse',
    sql: 'CREATE INDEX IF NOT EXISTS corpus.idx_corpus_browse ON postings_corpus(active, title)',
  },
  {
    // The DEFAULT view's ordering. Without it, newest-first is served by idx_corpus_active
    // and then sorted -- a temp B-tree over the whole active set to return one page,
    // measured at 26s on the live corpus.
    name: 'idx_corpus_active_seen',
    sql: 'CREATE INDEX IF NOT EXISTS corpus.idx_corpus_active_seen '
      + 'ON postings_corpus(active, first_seen_at DESC)',
  },
  {
    // "Highest salary" over the whole corpus. Expression index; it must match the sort
    // key BROWSE_SORT_MAP emits or the planner falls back to sorting the active set.
    name: 'idx_corpus_pay',
    sql: 'CREATE INDEX IF NOT EXISTS corpus.idx_corpus_pay '
      + 'ON postings_corpus(active, COALESCE(salary_max,salary_min,0) DESC)',
  },
  {
    // The same, for callers that narrow to the tracked lane (lane=target).
    name: 'idx_corpus_lane_seen',
    sql: 'CREATE INDEX IF NOT EXISTS corpus.idx_corpus_lane_seen '
      + 'ON postings_corpus(active, target_role, first_seen_at DESC)',
  },
];

/**
 * The full-text index, built separately from the plain indexes above because it is the
 * expensive one: 62s over 1.59M postings. Created and populated at most once per process,
 * and only when it is missing -- a request that arrives mid-build simply searches through
 * the LIKE fallback until it lands.
 */
const FULLTEXT_SQL = [
  "CREATE VIRTUAL TABLE IF NOT EXISTS corpus.postings_fts USING fts5("
    + "title, description, content='postings_corpus', content_rowid='id', tokenize='unicode61')",
  // The triggers FIRST, then the backfill: an external-content FTS table does not follow
  // its content table, so without them everything ingested after the build is invisible to
  // search. Creating them before the rebuild means a posting arriving mid-build is indexed
  // by the trigger rather than missed between the two statements.
  "CREATE TRIGGER IF NOT EXISTS corpus.postings_fts_insert AFTER INSERT ON postings_corpus"
    + " BEGIN INSERT INTO postings_fts(rowid, title, description)"
    + " VALUES (new.id, new.title, new.description); END",
  "CREATE TRIGGER IF NOT EXISTS corpus.postings_fts_delete AFTER DELETE ON postings_corpus"
    + " BEGIN INSERT INTO postings_fts(postings_fts, rowid, title, description)"
    + " VALUES ('delete', old.id, old.title, old.description); END",
  "CREATE TRIGGER IF NOT EXISTS corpus.postings_fts_update AFTER UPDATE ON postings_corpus"
    + " BEGIN INSERT INTO postings_fts(postings_fts, rowid, title, description)"
    + " VALUES ('delete', old.id, old.title, old.description);"
    + " INSERT INTO postings_fts(rowid, title, description)"
    + " VALUES (new.id, new.title, new.description); END",
  "INSERT INTO corpus.postings_fts(postings_fts) VALUES('rebuild')",
];

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
  let missing: typeof BROWSE_INDEXES = [];
  try {
    const present = new Set(
      (db.prepare(
        "SELECT name FROM corpus.sqlite_master WHERE type='index'",
      ).all() as { name: string }[]).map((row) => row.name),
    );
    missing = BROWSE_INDEXES.filter((index) => !present.has(index.name));
    if (!missing.length) { browseIndexState = 'ready'; return true; }
  } catch (err) {
    logger.warn({ err }, 'career browse index probe failed');
    browseIndexState = 'unavailable';
    return false;
  }
  const started = Date.now();
  const writable = openCorpusDb(false);
  if (!writable) { browseIndexState = 'unavailable'; return false; }
  try {
    for (const index of missing) writable.exec(index.sql);
    // The FTS table is checked separately: its absence is normal on a corpus built before
    // it existed, and building it is a minute of work rather than a few seconds.
    const fts = writable.prepare(
      "SELECT 1 AS ok FROM corpus.sqlite_master WHERE type='table' AND name='postings_fts'",
    ).get() as { ok?: number } | undefined;
    if (!fts?.ok) {
      const ftsStarted = Date.now();
      for (const statement of FULLTEXT_SQL) writable.exec(statement);
      logger.info({ ms: Date.now() - ftsStarted }, 'career full-text index built');
    }
    browseIndexState = 'ready';
    logger.info(
      { ms: Date.now() - started, built: missing.map((index) => index.name) },
      'career browse indexes created',
    );
    return true;
  } catch (err) {
    // Correctness does not depend on these -- only latency does. Say so once and move on.
    logger.warn(
      { err, ms: Date.now() - started }, 'career browse indexes unavailable; searches will scan',
    );
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
    ensureBrowseIndex(db);
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
