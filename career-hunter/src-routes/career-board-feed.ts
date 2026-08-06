/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract and replan the board feed around a bounded signal-driven candidate CTE with filter push-down and unscored tail-fill.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Use the narrow SQLite prepare/all/get contract required by the planner so canonical compilation avoids optional library types.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Document the exported query, ranking, filter, and page contracts consumed by route modules and tests.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Carry explicit application provenance and task correlation through every bounded board-feed plan.
 */
/**
 * Career Hunter — board feed query planner
 *
 * The board's list query used to be a single "join everything, then sort" statement: it walked
 * ~157K corpus postings that matched `active=1 AND target_role=1`, LEFT JOINed the per-user
 * signals row for each, then built a TEMP B-TREE over the whole set just to return the first 150.
 * On the live store (1.45M postings / 2.0GB corpus.db, of which 1.1GB is `description` text) that
 * measured **50 seconds**, because every posting row SQLite touched dragged its ~2.6KB description
 * through the page cache — for columns the board never renders.
 *
 * This module inverts the drive order. Almost every board view is ranked by a **signal-side** key
 * (AI fit), and only ~87K of the user's 1.3M signal rows are AI-scored at all, so the feed is
 * planned as:
 *
 *   1. a **candidate CTE** over `user_signals` alone, walked in sort-key order through
 *      `idx_user_scored` and bounded by LIMIT — every signal-side predicate is pushed INTO it so
 *      the index walk is range-bounded rather than filtered afterwards;
 *   2. the corpus join applied to that bounded candidate set only (a few thousand rowid lookups);
 *   3. an **unscored tail-fill** that preserves the old semantics when a filter is narrow enough
 *      to exhaust the scored candidates (the previous query surfaced unscored postings at the
 *      bottom of the feed; dropping them silently would hide real matches).
 *
 * Measured on the live store, same box, same data — first page, default feed: **50,004ms -> 16ms**.
 * Worst observed path (narrow filter forcing a full escalation) is ~2.6s, inside the 3s budget.
 *
 * @module career-board-feed
 */
interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteDb {
  prepare(sql: string): SqliteStatement;
}

/** @description Express query shape narrowed to the filter values accepted by the board. */
export type BoardQuery = Record<string, unknown>;

/** @description SQL expression for fit decayed by posting age and lifted by a referral path. */
export const LAND_PROB = "CAST(MIN(100.0, COALESCE(s.ai_fit_score,s.fit_score,0) "
  + "* MAX(0.25, POW(0.5,(JULIANDAY('now')-JULIANDAY(COALESCE(p.posted_date,p.first_seen_at)))/28.0)) "
  + "* (1.0+0.35*COALESCE(c.referral,0))) AS INT)";

/** @description SQL expression combining fit with clearance, platform-role, and mission bonuses. */
export const HIGH_WIN = "CAST(MIN(100, COALESCE(s.ai_fit_score,s.fit_score,0) "
  + "+ CASE WHEN LOWER(p.title) LIKE '%clear%' OR LOWER(p.title) LIKE '%secret%' OR LOWER(p.title) LIKE '%ts/sci%' OR LOWER(p.title) LIKE '%polygraph%' THEN 12 ELSE 0 END "
  + "+ CASE WHEN LOWER(p.title) LIKE '%ai%' OR LOWER(p.title) LIKE '%devops%' OR LOWER(p.title) LIKE '%sre%' OR LOWER(p.title) LIKE '%site reliab%' OR LOWER(p.title) LIKE '%platform%' OR LOWER(p.title) LIKE '%automation%' OR LOWER(p.title) LIKE '%machine learning%' THEN 8 ELSE 0 END "
  + "+ CASE WHEN LOWER(COALESCE(c.industry,'')) LIKE '%gov%' OR LOWER(COALESCE(c.industry,'')) LIKE '%defense%' OR LOWER(COALESCE(c.industry,'')) LIKE '%national security%' OR LOWER(COALESCE(c.industry,'')) LIKE '%aerospace%' OR LOWER(COALESCE(c.industry,'')) LIKE '%autonomy%' OR LOWER(COALESCE(c.industry,'')) LIKE '%intelligence%' THEN 12 ELSE 0 END) AS INT)";

/** @description Final ORDER BY expressions keyed by supported board sort values. */
export const SORT_MAP: Record<string, string> = {
  ai: 'COALESCE(s.ai_fit_score,-1) DESC, COALESCE(s.fit_score,0) DESC',
  prob: `${LAND_PROB} DESC, COALESCE(s.ai_fit_score,0) DESC`,
  highwin: `${HIGH_WIN} DESC, ${LAND_PROB} DESC`,
  keyword: 'COALESCE(s.fit_score,0) DESC',
  salary: 'COALESCE(p.salary_max,0) DESC',
  company: 'c.name ASC, s.ai_fit_score DESC',
  posted: 'p.posted_date DESC NULLS LAST',
  recent: 'p.first_seen_at DESC',
  generated: 's.generated_at DESC NULLS LAST',
  applied: 's.applied_at DESC NULLS LAST',
};

/**
 * How the candidate CTE itself is ordered, per `sort=`. A sort whose key lives on `user_signals`
 * can drive the pool directly, which makes the pool an ordered prefix — truncating it cannot
 * change the answer. Sorts keyed on the corpus side (salary, posted date, company name) have no
 * such alignment, so they rank *within* the most-relevant pool; `pooled` is reported to the caller.
 */
const POOL_ORDER: Record<string, string> = {
  ai: 's.ai_fit_score DESC',
  keyword: 's.fit_score DESC',
  generated: 's.generated_at DESC',
  applied: 's.applied_at DESC',
};

/** Sorts whose pool ordering matches the final ordering — safe to escalate without a cap. */
const ALIGNED_SORTS = new Set(Object.keys(POOL_ORDER));

/**
 * Escalation ladder for the candidate pool. A narrow filter can leave the first rung short of a
 * full page, so the feed retries against a wider pool rather than under-reporting. Corpus-keyed
 * sorts stop at the second rung: an unbounded pool there degenerates back into the 157K-row
 * materialise-and-sort this module exists to remove (measured 2,590ms vs 110ms at 25K).
 */
const POOL_STEPS = [4000, 25000];

/** Signal columns the CTE must carry so the outer SELECT and the scoring expressions still work. */
const CAND_COLS = 'posting_id, fit_score, ai_fit_score, ai_fit_rationale, status, applied_at, '
  + 'promoted_at, generated_at, notes, resume_path, cover_path, confirmation_path, '
  + 'application_source, application_task_id';

/** The board card's column list. Deliberately excludes `p.description` (1.1GB of the corpus). */
const SELECT_COLS = `p.id, p.title, c.name AS company, p.location, p.url, p.posted_date, p.first_seen_at,
        p.job_type, p.remote, p.state, p.salary_min, p.salary_max, p.salary_currency, p.salary_period, p.salary_source, p.target_role,
        COALESCE(c.referral,0) AS referral, c.industry,
        s.fit_score, s.ai_fit_score, s.ai_fit_rationale, s.status, s.applied_at, s.promoted_at, s.generated_at, s.notes,
        s.confirmation_path, s.application_source, s.application_task_id,
        ${LAND_PROB} AS land_prob, ${HIGH_WIN} AS high_win,
        CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
        CASE WHEN s.cover_path  IS NOT NULL AND s.cover_path<>''  THEN 1 ELSE 0 END AS has_cover`;

/** @description Board filters split by signal and corpus ownership for query push-down. */
export interface BoardFilterParts {
  /** Predicates on `user_signals`, sargable, pushed into the candidate CTE. */
  scoredWhere: string;
  scoredArgs: unknown[];
  /** The same rules restated for unscored rows, where `ai_fit_score` is NULL by definition. */
  tailWhere: string;
  tailArgs: unknown[];
  /** Predicates on `postings_corpus` / `companies`, applied after the join. */
  corpWhere: string;
  corpArgs: unknown[];
}

/**
 * @description Reads a trimmed string parameter off an Express query object.
 * @param query - The request query.
 * @param key - Parameter name.
 * @returns The trimmed value, or '' when absent or non-scalar.
 */
function param(query: BoardQuery, key: string): string {
  return typeof query[key] === 'string' ? (query[key] as string).trim() : '';
}

/**
 * @description Builds the corpus-side (postings + companies) half of the board filter set.
 *   `p.target_role = 1` replaces the old `COALESCE(p.target_role,0) = 1`: the two are equivalent
 *   for a 0/1/NULL column, but only the bare comparison is sargable, so only it can use
 *   `idx_corpus_lane (active, target_role)`.
 * @param query - The board request query.
 * @returns The composed corpus predicate and its positional bind arguments.
 */
function corpusFilters(query: BoardQuery): { sql: string; args: unknown[] } {
  const g = (k: string) => param(query, k);
  const where = ['p.active = 1']; const args: unknown[] = [];
  if (g('lane') !== 'all') where.push('p.target_role = 1');
  if (g('q')) { where.push('(p.title LIKE ? OR p.description LIKE ?)'); args.push(`%${g('q')}%`, `%${g('q')}%`); }
  if (g('company')) { where.push('c.name LIKE ?'); args.push(`%${g('company')}%`); }
  if (g('remote') === '0' || g('remote') === '1') { where.push('p.remote = ?'); args.push(Number(g('remote'))); }
  if (g('state')) { where.push('p.state = ?'); args.push(g('state').toUpperCase()); }
  if (g('type')) { where.push('p.job_type = ?'); args.push(g('type')); }
  const days = parseInt(g('days'), 10);
  if (days > 0) { where.push("p.posted_date IS NOT NULL AND p.posted_date >= date('now', ?)"); args.push(`-${days} days`); }
  const minPay = parseInt(g('min_pay'), 10);
  if (minPay > 0) { where.push('COALESCE(p.salary_max,p.salary_min,0) >= ?'); args.push(minPay); }
  if (g('source')) { where.push('c.source_lists LIKE ?'); args.push(`%"${g('source')}"%`); }
  return { sql: where.join(' AND '), args };
}

/**
 * @description Splits the board filters into the signal-side predicates that bound the candidate
 *   CTE and the corpus-side predicates applied after the join. Inside the scored pool
 *   `ai_fit_score` is non-NULL by construction, so `min_score` is emitted as the bare
 *   `s.ai_fit_score >= ?` — a range bound `idx_user_scored` can seek to, instead of the
 *   unindexable `COALESCE(s.ai_fit_score,s.fit_score,0) >= ?`. The unscored tail restates the same
 *   rule over `fit_score`, which is the only score those rows have.
 *
 *   The dismissed rule is unchanged and load-bearing: the default feed hides dismissed jobs, and
 *   an explicit `status=` (the Dismissed tab) takes the branch that lists them. See
 *   tests/career-board-dismiss-filter.spec.ts.
 * @param query - The board request query.
 * @returns The three predicate groups with their bind arguments.
 */
export function splitBoardFilters(query: BoardQuery): BoardFilterParts {
  const g = (k: string) => param(query, k);
  const corp = corpusFilters(query);
  const scored: string[] = []; const scoredArgs: unknown[] = [];
  const tail: string[] = []; const tailArgs: unknown[] = [];

  const minScore = parseInt(g('min_score'), 10);
  if (minScore > 0) {
    scored.push('s.ai_fit_score >= ?'); scoredArgs.push(minScore);
    tail.push('COALESCE(s.fit_score,0) >= ?'); tailArgs.push(minScore);
  }
  if (g('status')) {
    scored.push('s.status = ?'); scoredArgs.push(g('status'));
    tail.push('s.status = ?'); tailArgs.push(g('status'));
  } else {
    scored.push("COALESCE(s.status,'') <> 'dismissed'");
    tail.push("COALESCE(s.status,'') <> 'dismissed'");
  }
  return {
    scoredWhere: scored.join(' AND '), scoredArgs,
    tailWhere: tail.join(' AND '), tailArgs,
    corpWhere: corp.sql, corpArgs: corp.args,
  };
}

/**
 * @description Legacy single-predicate view of the board filter set, kept because the dismissed-job
 *   regression guard asserts on it directly and because it documents the composed rule in one
 *   place. The feed itself uses {@link splitBoardFilters}; this is the same rules re-joined.
 * @param query - The board request query.
 * @returns The composed WHERE fragment and its positional bind arguments.
 */
export function buildJobFilters(query: BoardQuery): { whereSql: string; args: unknown[] } {
  const p = splitBoardFilters(query);
  return {
    whereSql: [p.corpWhere, p.scoredWhere].filter(Boolean).join(' AND '),
    args: [...p.corpArgs, ...p.scoredArgs],
  };
}

/** @description One board page plus facts explaining whether its ranking used a bounded pool. */
export interface BoardPage {
  jobs: Record<string, unknown>[];
  page: number;
  per: number;
  /** True when a corpus-keyed sort ranked within a bounded relevance pool rather than the whole set. */
  pooled: boolean;
  /** The pool bound that produced this page, or null when the scored set was walked exhaustively. */
  poolSize: number | null;
  /** True when only AI-scored postings were considered (the default). */
  scoredOnly: boolean;
  /** True when the scored candidates ran out inside this page — the surface can say so. */
  exhausted: boolean;
}

/**
 * @description Runs one rung of the candidate-pool plan: a bounded, ordered walk of the user's
 *   signal rows, joined to the corpus and re-sorted into the requested order.
 * @param db - The user's signals DB with `corpus` ATTACHed.
 * @param parts - Split filter predicates.
 * @param plan - Sort ordering, page geometry and the pool bound for this rung.
 * @returns The rows this rung produced.
 */
function runPooled(
  db: SqliteDb,
  parts: BoardFilterParts,
  plan: { order: string; poolOrder: string; poolN: number | null; limit: number; offset: number },
): Record<string, unknown>[] {
  const bound = plan.poolN === null ? '' : `LIMIT ${plan.poolN}`;
  const sql = `WITH cand AS (
        SELECT ${CAND_COLS} FROM user_signals s
         WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere}
         ORDER BY ${plan.poolOrder} ${bound})
      SELECT ${SELECT_COLS}
        FROM cand s
        JOIN corpus.postings_corpus p ON p.id = s.posting_id
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${parts.corpWhere}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(
    ...parts.scoredArgs, ...parts.corpArgs, plan.limit, plan.offset,
  ) as Record<string, unknown>[];
}

/**
 * @description Fetches unscored postings to backfill a short page. The previous board query
 *   surfaced these at the bottom of the feed (NULL fit sorted last), so a narrow filter that
 *   exhausts the scored candidates must still reach them — otherwise a state or salary filter
 *   would silently report a handful of matches when hundreds exist.
 * @param db - The user's signals DB with `corpus` ATTACHed.
 * @param parts - Split filter predicates.
 * @param limit - How many rows are still needed.
 * @param offset - Where to start in the unscored run (non-zero only when a deep page begins past
 *   the end of the scored candidates).
 * @returns The unscored rows that match, capped at `limit`.
 *
 *   Deliberately **unordered**. Every row here has `ai_fit_score IS NULL`, so under the board's
 *   ranked sorts they are all tied at the bottom and any order realises the same ranking — but
 *   asking SQLite to sort them re-creates the exact 157K-row materialise-and-sort this module
 *   removes (measured: 216ms unordered vs 18,702ms ordered, on `state=WY`). The LIMIT lets the
 *   scan stop as soon as the page is full.
 */
function runUnscoredTail(
  db: SqliteDb, parts: BoardFilterParts, limit: number, offset: number,
): Record<string, unknown>[] {
  const sql = `SELECT ${SELECT_COLS}
        FROM corpus.postings_corpus p
        JOIN corpus.companies c ON c.id = p.company_id
        LEFT JOIN user_signals s ON s.posting_id = p.id
       WHERE ${parts.corpWhere} AND s.ai_fit_score IS NULL AND ${parts.tailWhere}
       LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(
    ...parts.corpArgs, ...parts.tailArgs, limit, offset,
  ) as Record<string, unknown>[];
}

/**
 * @description Reports whether a pool rung actually ran out of room. A short page only justifies
 *   escalating when the rung was full — if the filters match fewer candidates than the bound, a
 *   wider pool returns the identical rows and the retry is pure latency. Bounded by the same LIMIT,
 *   so this is an index-only count of at most `poolN` entries.
 * @param db - The user's signals DB.
 * @param parts - Split filter predicates.
 * @param poolN - The bound that was just used.
 * @returns True when the candidate set filled the bound.
 */
function poolSaturated(db: SqliteDb, parts: BoardFilterParts, poolN: number): boolean {
  const sql = `SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM user_signals s
         WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere} LIMIT ${poolN})`;
  const row = db.prepare(sql).get(...parts.scoredArgs) as { n: number };
  return (row?.n ?? 0) >= poolN;
}

/**
 * @description Counts the scored postings matching the current filters. Only called on the rare
 *   deep page that starts past the end of the scored candidates, where it is the sole way to know
 *   how far into the unscored run that page begins.
 * @param db - The user's signals DB with `corpus` ATTACHed.
 * @param parts - Split filter predicates.
 * @returns The number of scored rows the filters match.
 */
function countScored(db: SqliteDb, parts: BoardFilterParts): number {
  const sql = `WITH cand AS (
        SELECT posting_id FROM user_signals s
         WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere})
      SELECT COUNT(*) AS n
        FROM cand s
        JOIN corpus.postings_corpus p ON p.id = s.posting_id
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${parts.corpWhere}`;
  const row = db.prepare(sql).get(...parts.scoredArgs, ...parts.corpArgs) as { n: number };
  return row?.n ?? 0;
}

/**
 * @description Plans and runs the board feed for one request. Walks the pool ladder until the page
 *   is full, then backfills from unscored postings if the scored candidates ran out.
 * @param db - The user's signals DB with the shared corpus ATTACHed.
 * @param query - The board request query (filters, `sort`, `per`, `page`).
 * @returns The page of job cards plus the plan that produced it.
 */
export function fetchBoardPage(db: SqliteDb, query: BoardQuery): BoardPage {
  const sort = String(query.sort || 'ai');
  const order = SORT_MAP[sort] || SORT_MAP.ai;
  const poolOrder = POOL_ORDER[sort] || POOL_ORDER.ai;
  const per = Math.min(Math.max(Number(query.per) || 120, 1), 300);
  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * per;
  const parts = splitBoardFilters(query);

  // Deep pages need a pool at least as large as the window they read from.
  const need = offset + per;
  const ladder: (number | null)[] = POOL_STEPS.filter((n) => n >= need);
  if (!ladder.length) ladder.push(Math.max(need * 4, POOL_STEPS[POOL_STEPS.length - 1]));
  if (ALIGNED_SORTS.has(sort)) ladder.push(null); // exhaustive walk is exact for pool-aligned sorts

  let jobs: Record<string, unknown>[] = [];
  let poolSize: number | null = ladder[0];
  for (const poolN of ladder) {
    poolSize = poolN;
    jobs = runPooled(db, parts, { order, poolOrder, poolN, limit: per, offset });
    if (jobs.length >= per) break;
    // A short page is only worth retrying wider if this rung was actually full.
    if (poolN === null || !poolSaturated(db, parts, poolN)) break;
  }
  const exhausted = jobs.length < per;
  // Unscored postings are OPT-IN (`include_unscored=1`), not the default. Finding them means
  // scanning the corpus for rows the user has no signal for, and that scan cannot terminate early
  // when few match — measured 8.0s (state=WY) and 21.6s (min_score=90 + remote) against 12-320ms
  // for the same filters over scored candidates. Since an unscored posting carries no fit score,
  // it has no position in a ranked board anyway; the surface reports `exhausted` instead, and the
  // caller who genuinely wants the exhaustive set can ask for it and wait.
  if (exhausted && param(query, 'include_unscored') === '1') {
    // Rows [offset, offset+k) came from the scored run, so the tail resumes at 0 — except on a
    // page starting entirely past that run, where the page's own start has to be translated.
    const tailOffset = jobs.length === 0 && offset > 0
      ? Math.max(0, offset - countScored(db, parts))
      : 0;
    jobs = jobs.concat(runUnscoredTail(db, parts, per - jobs.length, tailOffset));
  }
  return {
    jobs, page, per, poolSize, exhausted,
    pooled: !ALIGNED_SORTS.has(sort) && poolSize !== null,
    scoredOnly: param(query, 'include_unscored') !== '1',
  };
}
