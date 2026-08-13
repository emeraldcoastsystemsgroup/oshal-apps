"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_OFFSET = exports.MAX_PER = exports.BROWSE_POOL = exports.BROWSE_SORT_MAP = void 0;
exports.browseFilters = browseFilters;
exports.browsePageGeometry = browsePageGeometry;
exports.fetchBrowsePage = fetchBrowsePage;
/**
 * @description ORDER BY expressions keyed by supported browse sort values. Every key is a corpus
 *   column — there are no signals to sort by, which is the whole point of this feed.
 */
exports.BROWSE_SORT_MAP = {
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
exports.BROWSE_POOL = 20000;
/** Page geometry ceilings. Deep paging on a scan-shaped feed is where latency actually lives. */
exports.MAX_PER = 100;
exports.MAX_OFFSET = 2000;
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
function param(query, key) {
    return typeof query[key] === 'string' ? query[key].trim() : '';
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
function browseFilters(query) {
    const g = (k) => param(query, k);
    const where = ['p.active = 1'];
    const args = [];
    if (g('lane') !== 'all')
        where.push('p.target_role = 1');
    if (g('company')) {
        where.push('c.name LIKE ?');
        args.push(`%${g('company')}%`);
    }
    if (g('remote') === '0' || g('remote') === '1') {
        where.push('p.remote = ?');
        args.push(Number(g('remote')));
    }
    if (g('state')) {
        where.push('p.state = ?');
        args.push(g('state').toUpperCase());
    }
    if (g('type')) {
        where.push('p.job_type = ?');
        args.push(g('type'));
    }
    const days = parseInt(g('days'), 10);
    if (days > 0) {
        where.push("p.posted_date IS NOT NULL AND p.posted_date >= date('now', ?)");
        args.push(`-${days} days`);
    }
    const minPay = parseInt(g('min_pay'), 10);
    if (minPay > 0) {
        where.push('COALESCE(p.salary_max,p.salary_min,0) >= ?');
        args.push(minPay);
    }
    return { where: where.join(' AND '), args };
}
/**
 * @description Normalises page geometry, clamping both the page size and how deep a caller may
 *   page. A scan-shaped feed has no cheap way to reach offset 50,000, so the depth is refused
 *   explicitly instead of being served slowly.
 * @param query - The browse request query.
 * @returns The page number, page size, row offset, and whether the depth was clamped.
 */
function browsePageGeometry(query) {
    const per = Math.min(Math.max(Number(query.per) || 60, 1), exports.MAX_PER);
    const page = Math.max(1, Number(query.page) || 1);
    const offset = (page - 1) * per;
    return { page, per, offset: Math.min(offset, exports.MAX_OFFSET), capped: offset > exports.MAX_OFFSET };
}
/**
 * @description Runs a browse page whose keyword term drives a bounded candidate pool.
 * @param db - A handle with the shared corpus reachable as `corpus`.
 * @param term - The trimmed keyword, matched against posting titles only.
 * @param filters - The remaining corpus predicate and its arguments.
 * @param plan - Sort ordering and page geometry.
 * @returns The rows this page produced.
 */
function runSearch(db, term, filters, plan) {
    const sql = `WITH cand AS (
        SELECT id FROM corpus.postings_corpus
         WHERE active = 1 AND title LIKE ?
         LIMIT ${exports.BROWSE_POOL})
      SELECT ${SELECT_COLS}
        FROM cand
        JOIN corpus.postings_corpus p ON p.id = cand.id
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${filters.where}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(`%${term}%`, ...filters.args, plan.per, plan.offset);
}
/**
 * @description Runs a browse page with no keyword term, driven straight off the sort index.
 * @param db - A handle with the shared corpus reachable as `corpus`.
 * @param filters - The corpus predicate and its arguments.
 * @param plan - Sort ordering and page geometry.
 * @returns The rows this page produced.
 */
function runFeed(db, filters, plan) {
    const sql = `SELECT ${SELECT_COLS}
        FROM corpus.postings_corpus p
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${filters.where}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...filters.args, plan.per, plan.offset);
}
/**
 * @description Plans and runs one page of the corpus-only browse feed.
 * @param db - A SQLite handle with the shared corpus reachable as `corpus`. No `user_signals`
 *   table is read or required, so this works for an account that has never uploaded a resume.
 * @param query - The browse request query (`q`, filters, `sort`, `per`, `page`).
 * @returns The page of score-free job cards plus the plan that produced it.
 */
function fetchBrowsePage(db, query) {
    const sort = String(query.sort || 'recent');
    const order = exports.BROWSE_SORT_MAP[sort] || exports.BROWSE_SORT_MAP.recent;
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
        poolSize: term ? exports.BROWSE_POOL : null,
        exhausted: jobs.length < per,
        capped,
    };
}
//# sourceMappingURL=career-browse-feed.js.map