/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Plan a corpus-only board feed so a signed-in user with no indexed resume can still search the openings.
 */
/**
 * Career Hunter — corpus-only browse feed.
 *
 * The scored board ({@link module:career-board-feed}) drives from `user_signals`: it walks the
 * caller's AI-scored rows in sort-key order and joins the corpus to whatever that bounded pool
 * returns. That is the right plan for a user who HAS a resume, and it returns nothing at all for a
 * user who does not — a brand-new account has zero signal rows, so the board had nothing to render
 * and the surface hid its own search bar behind the onboarding card.
 *
 * This module plans the other half: the shared corpus with **no signals table involved**, so the
 * openings are searchable before a resume exists. It is deliberately NOT the scored feed with the
 * join removed:
 *
 *   - There are no scores here, so there is no `fit` ranking to preserve. The default order is
 *     `first_seen_at DESC`, which `idx_corpus_seen` serves as a bounded index walk.
 *   - A keyword search matches **titles only**. `postings_corpus.description` is ~1.1GB of the
 *     ~2.0GB live corpus and is stored inline, so `title LIKE ? OR description LIKE ?` drags every
 *     row's description through the page cache — the exact shape that measured 50s on the scored
 *     board before it was replanned. Titles alone fit in a covering index.
 *   - That search runs as a bounded **candidate CTE** over `idx_corpus_browse (active, title)`.
 *     Selecting only `id` keeps the statement covered by that index, so a leading-wildcard LIKE
 *     scans ~65MB of title keys instead of ~2GB of rows, and the LIMIT lets a common term stop
 *     early. The pool is unordered — every ordering the browse offers lives on the corpus side, so
 *     ranking happens after the join and `pooled` reports that the ranking saw a bounded set.
 *
 * @module career-browse-feed
 */
interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteDb {
  prepare(sql: string): SqliteStatement;
}

/** @description Express query shape narrowed to the filter values accepted by the browse feed. */
export type BrowseQuery = Record<string, unknown>;

/**
 * @description ORDER BY expressions keyed by supported browse sort values. Every key is a corpus
 *   column — there are no signals to sort by, which is the whole point of this feed.
 */
export const BROWSE_SORT_MAP: Record<string, string> = {
  recent: 'p.first_seen_at DESC',
  posted: 'p.posted_date DESC NULLS LAST',
  salary: 'COALESCE(p.salary_max,p.salary_min,0) DESC',
  company: 'c.name ASC, p.first_seen_at DESC',
  title: 'p.title ASC',
};

/**
 * Bound on the candidate pool a keyword search ranks within. The pool is an index scan, not a row
 * scan, so this is cheap to raise — but it is not unbounded, because a term matching a large slice
 * of the corpus would otherwise materialise hundreds of thousands of ids to return one page.
 */
export const BROWSE_POOL = 20000;

/** Page geometry ceilings. Deep paging on a scan-shaped feed is where latency actually lives. */
export const MAX_PER = 100;
export const MAX_OFFSET = 2000;

/** The browse card's columns. Deliberately excludes `p.description` (1.1GB of the corpus). */
const SELECT_COLS = `p.id, p.title, c.name AS company, c.industry, p.location, p.url,
        p.posted_date, p.first_seen_at, p.job_type, p.remote, p.state,
        p.salary_min, p.salary_max, p.salary_currency, p.salary_period`;

/**
 * @description Reads a trimmed string parameter off an Express query object.
 * @param query - The request query.
 * @param key - Parameter name.
 * @returns The trimmed value, or '' when absent or non-scalar.
 */
function param(query: BrowseQuery, key: string): string {
  return typeof query[key] === 'string' ? (query[key] as string).trim() : '';
}

/**
 * @description Builds the corpus-side predicate for a browse request, excluding the keyword term.
 *   `q` is handled separately because it is the only filter that drives the candidate pool; every
 *   rule here is applied after the join, where it costs one row lookup per candidate.
 *
 *   `p.target_role = 1` is written bare rather than wrapped in COALESCE so `idx_corpus_lane` can
 *   serve it — the same sargability rule the scored feed's guard enforces.
 * @param query - The browse request query.
 * @returns The composed predicate and its positional bind arguments.
 */
export function browseFilters(query: BrowseQuery): { where: string; args: unknown[] } {
  const g = (k: string) => param(query, k);
  const where = ['p.active = 1'];
  const args: unknown[] = [];
  if (g('lane') !== 'all') where.push('p.target_role = 1');
  if (g('company')) { where.push('c.name LIKE ?'); args.push(`%${g('company')}%`); }
  if (g('remote') === '0' || g('remote') === '1') { where.push('p.remote = ?'); args.push(Number(g('remote'))); }
  if (g('state')) { where.push('p.state = ?'); args.push(g('state').toUpperCase()); }
  if (g('type')) { where.push('p.job_type = ?'); args.push(g('type')); }
  const days = parseInt(g('days'), 10);
  if (days > 0) { where.push("p.posted_date IS NOT NULL AND p.posted_date >= date('now', ?)"); args.push(`-${days} days`); }
  const minPay = parseInt(g('min_pay'), 10);
  if (minPay > 0) { where.push('COALESCE(p.salary_max,p.salary_min,0) >= ?'); args.push(minPay); }
  return { where: where.join(' AND '), args };
}

/** @description One page of browsable openings plus the facts explaining how it was ranked. */
export interface BrowsePage {
  jobs: Record<string, unknown>[];
  page: number;
  per: number;
  /** Always true — the surface uses it to render score-free cards and an Apply-now that onboards. */
  browse: true;
  /** True when a keyword search ranked within a bounded candidate pool rather than every match. */
  pooled: boolean;
  /** The pool bound that produced this page, or null when no keyword search was requested. */
  poolSize: number | null;
  /** True when this page came back short — the caller can say "that's everything". */
  exhausted: boolean;
  /** True when the requested page was past {@link MAX_OFFSET} and was refused rather than scanned. */
  capped: boolean;
}

/**
 * @description Normalises page geometry, clamping both the page size and how deep a caller may
 *   page. A scan-shaped feed has no cheap way to reach offset 50,000, so the depth is refused
 *   explicitly instead of being served slowly.
 * @param query - The browse request query.
 * @returns The page number, page size, row offset, and whether the depth was clamped.
 */
export function browsePageGeometry(
  query: BrowseQuery,
): { page: number; per: number; offset: number; capped: boolean } {
  const per = Math.min(Math.max(Number(query.per) || 60, 1), MAX_PER);
  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * per;
  return { page, per, offset: Math.min(offset, MAX_OFFSET), capped: offset > MAX_OFFSET };
}

/**
 * @description Runs a browse page whose keyword term drives a bounded candidate pool.
 * @param db - A handle with the shared corpus reachable as `corpus`.
 * @param term - The trimmed keyword, matched against posting titles only.
 * @param filters - The remaining corpus predicate and its arguments.
 * @param plan - Sort ordering and page geometry.
 * @returns The rows this page produced.
 */
function runSearch(
  db: SqliteDb,
  term: string,
  filters: { where: string; args: unknown[] },
  plan: { order: string; per: number; offset: number },
): Record<string, unknown>[] {
  const sql = `WITH cand AS (
        SELECT id FROM corpus.postings_corpus
         WHERE active = 1 AND title LIKE ?
         LIMIT ${BROWSE_POOL})
      SELECT ${SELECT_COLS}
        FROM cand
        JOIN corpus.postings_corpus p ON p.id = cand.id
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${filters.where}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(
    `%${term}%`, ...filters.args, plan.per, plan.offset,
  ) as Record<string, unknown>[];
}

/**
 * @description Runs a browse page with no keyword term, driven straight off the sort index.
 * @param db - A handle with the shared corpus reachable as `corpus`.
 * @param filters - The corpus predicate and its arguments.
 * @param plan - Sort ordering and page geometry.
 * @returns The rows this page produced.
 */
function runFeed(
  db: SqliteDb,
  filters: { where: string; args: unknown[] },
  plan: { order: string; per: number; offset: number },
): Record<string, unknown>[] {
  const sql = `SELECT ${SELECT_COLS}
        FROM corpus.postings_corpus p
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${filters.where}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(
    ...filters.args, plan.per, plan.offset,
  ) as Record<string, unknown>[];
}

/**
 * @description Plans and runs one page of the corpus-only browse feed.
 * @param db - A SQLite handle with the shared corpus reachable as `corpus`. No `user_signals`
 *   table is read or required, so this works for an account that has never uploaded a resume.
 * @param query - The browse request query (`q`, filters, `sort`, `per`, `page`).
 * @returns The page of score-free job cards plus the plan that produced it.
 */
export function fetchBrowsePage(db: SqliteDb, query: BrowseQuery): BrowsePage {
  const sort = String(query.sort || 'recent');
  const order = BROWSE_SORT_MAP[sort] || BROWSE_SORT_MAP.recent;
  const { page, per, offset, capped } = browsePageGeometry(query);
  const filters = browseFilters(query);
  const term = param(query, 'q');

  if (capped) {
    return {
      jobs: [], page, per, browse: true, pooled: false, poolSize: null, exhausted: true, capped,
    };
  }
  const plan = { order, per, offset };
  const jobs = term
    ? runSearch(db, term, filters, plan)
    : runFeed(db, filters, plan);
  return {
    jobs,
    page,
    per,
    browse: true,
    pooled: !!term,
    poolSize: term ? BROWSE_POOL : null,
    exhausted: jobs.length < per,
    capped,
  };
}
