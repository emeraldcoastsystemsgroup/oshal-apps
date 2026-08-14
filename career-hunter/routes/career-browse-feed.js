"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FTS_TABLE = exports.MAX_OFFSET = exports.MAX_PER = exports.ARM_POOL = exports.BROWSE_POOL = exports.BROWSE_SORT_MAP = void 0;
exports.browseFilters = browseFilters;
exports.browsePageGeometry = browsePageGeometry;
exports.searchCandidateSql = searchCandidateSql;
exports.fetchBrowsePage = fetchBrowsePage;
exports.hasFullText = hasFullText;
exports.ftsMatchExpression = ftsMatchExpression;
exports.ftsExpressionFor = ftsExpressionFor;
/**
 * @description ORDER BY expressions keyed by supported browse sort values. Every key is a corpus
 *   column — there are no signals to sort by, which is the whole point of this feed.
 */
exports.BROWSE_SORT_MAP = {
    // NOTE: there is deliberately no `company` sort. `c.name` lives on the joined table, so
    // no index can serve it, and ordering 1.6M postings by employer name to show twenty rows
    // measured 29.9s -- for an answer ("twenty jobs at companies starting with a digit") that
    // nobody asked for. Filter by company instead; that is indexed and instant.
    recent: 'p.first_seen_at DESC',
    posted: 'p.posted_date DESC NULLS LAST',
    salary: 'COALESCE(p.salary_max,p.salary_min,0) DESC',
    title: 'p.title ASC',
};
/**
 * Bound on the candidate pool a keyword search ranks within. The pool is an index scan, not a row
 * scan, so this is cheap to raise — but it is not unbounded, because a term matching a large slice
 * of the corpus would otherwise materialise hundreds of thousands of ids to return one page.
 */
exports.BROWSE_POOL = 20000;
/**
 * How many candidates ONE search arm may contribute. This is the number that decides
 * whether a search is fast: every candidate costs a random rowid lookup into a 2GB
 * table, so the pool bound is a row-read budget, not a relevance setting. 600 per arm
 * took `engineer` from 33s to well under a second on the live corpus.
 */
exports.ARM_POOL = 600;
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
 * @description Builds the corpus-side predicate for a browse request, excluding the keyword term,
 *   split so the posting-side half can be pushed into the search arms.
 *
 *   `p.target_role = 1` is written bare rather than wrapped in COALESCE so an index can serve
 *   it — the same sargability rule the scored feed's guard enforces.
 * @param query - The browse request query.
 * @returns The split predicates and their positional bind arguments.
 */
function browseFilters(query) {
    const g = (k) => param(query, k);
    const posting = ['p.active = 1'];
    const postingArgs = [];
    const company = [];
    const companyArgs = [];
    // The DEFAULT here is the whole corpus, and that inverts the scored board on purpose.
    // `target_role` marks the postings this deployment tracks for resume matching; filtering
    // by it on a general search means a search for "nurse" returns almost nothing, because
    // nursing is not a target role -- measured 1 hit against 1.6M postings, which reads as a
    // broken search rather than a policy. Someone searching a job database is asking about
    // the database. `lane=target` opts back into the tracked lane for callers that want it.
    if (g('lane') === 'target')
        posting.push('p.target_role = 1');
    if (g('company')) {
        company.push('c.name LIKE ?');
        companyArgs.push(`%${g('company')}%`);
    }
    if (g('remote') === '0' || g('remote') === '1') {
        posting.push('p.remote = ?');
        postingArgs.push(Number(g('remote')));
    }
    if (g('state')) {
        posting.push('p.state = ?');
        postingArgs.push(g('state').toUpperCase());
    }
    if (g('type')) {
        posting.push('p.job_type = ?');
        postingArgs.push(g('type'));
    }
    const days = parseInt(g('days'), 10);
    if (days > 0) {
        posting.push("p.posted_date IS NOT NULL AND p.posted_date >= date('now', ?)");
        postingArgs.push(`-${days} days`);
    }
    const minPay = parseInt(g('min_pay'), 10);
    if (minPay > 0) {
        posting.push('COALESCE(p.salary_max,p.salary_min,0) >= ?');
        postingArgs.push(minPay);
    }
    return {
        where: [...posting, ...company].join(' AND '),
        args: [...postingArgs, ...companyArgs],
        postingWhere: posting.join(' AND '),
        postingArgs,
    };
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
function searchCandidateSql(deep, postingWhere = 'active = 1') {
    // EVERY arm is independently ordered and bounded, and that is the whole design.
    //
    // An unordered pool has to be materialised before the outer query can rank it, and each
    // candidate costs a random rowid lookup into a 2GB table whose rows carry ~2.6KB of
    // description. At a 20,000-row pool that measured **33 seconds** for `engineer` on the
    // live 1.6M-posting corpus. Ordering inside the arm turns the scan into a bounded
    // top-N over integer ids — no row is touched until the pool is already small.
    //
    // `id DESC` rather than `first_seen_at DESC`: ids are assigned at ingest, so they track
    // arrival, and unlike the date they are IN the covering index as the rowid. Ordering by
    // the date here would re-introduce the row lookups this bound exists to avoid; the final
    // ordering the caller asked for is still applied by the outer query.
    // `cid`, not `id`: the employer arm joins two tables that BOTH have an `id`, so
    // ordering on the bare name is an "ambiguous column name" error rather than a slow
    // query — the kind of break a fixture catches and a production corpus never gets to.
    //
    // `cid + 0`, not `cid`, and it is load-bearing. `cid` IS the rowid, so a bare
    // `ORDER BY cid DESC` lets SQLite satisfy the ordering by walking any index in rowid
    // order — and it duly picks `idx_corpus_active`, which does NOT carry the title, so
    // every entry needs a row read to test the LIKE. Measured on the live corpus, that is
    // the whole table. The `+ 0` makes the sort key an expression rather than the rowid,
    // so the planner goes back to the covering index and sorts the integer ids it already
    // has. Verified by the query-plan guard, which asserts covered AND unsorted-by-rows.
    const arm = (body) => `SELECT cid AS id FROM (${body} ORDER BY cid + 0 DESC LIMIT ${exports.ARM_POOL})`;
    // Arm 1 — titles. Covered by idx_corpus_browse (active, title): a leading-wildcard
    // LIKE scans ~65MB of title keys rather than ~2GB of rows.
    const arms = [
        arm(`SELECT id AS cid FROM corpus.postings_corpus p WHERE ${postingWhere} AND p.title LIKE ?`),
    ];
    // Arm 2 — employer names. `companies` is a few thousand rows, so the scan is trivial,
    // and its postings come back through idx_corpus_company_active. This is what makes
    // "search by company name" work from the same box a user types a job title into.
    // CROSS JOIN, and it is not decorative: in SQLite it is the documented way to PIN the
    // loop order, and the order is the whole performance story here. Left to reorder, the
    // planner drives from `postings_corpus` — every active posting, one company lookup each
    // — because on a corpus with no ANALYZE it cannot know `companies` is thousands of rows
    // against millions. Driving from the small side instead, matching employers' postings
    // come back through idx_corpus_company_active.
    arms.push(arm(`SELECT p.id AS cid FROM corpus.companies c
            CROSS JOIN corpus.postings_corpus p ON p.company_id = c.id
           WHERE c.name LIKE ? AND ${postingWhere}`));
    // Arm 3 — the full posting text, and the ONLY arm that is not index-served. `description`
    // is ~1.1GB of the ~2.0GB corpus and is stored inline, so this is a real table scan
    // (measured 8-21s on the live store when few rows match). It is therefore opt-in per
    // request and labelled as slow on the surface, never the default.
    if (deep) {
        arms.push(arm(`SELECT id AS cid FROM corpus.postings_corpus p WHERE ${postingWhere} AND p.description LIKE ?`));
    }
    return { sql: arms.join('\n         UNION\n        '), arms: arms.length, parts: arms };
}
/**
 * @description Runs a search page whose term drives a bounded candidate pool.
 * @param db - A handle with the shared corpus reachable as `corpus`.
 * @param term - The trimmed keyword.
 * @param deep - Whether to also scan posting descriptions (slow, opt-in).
 * @param filters - The remaining corpus predicate and its arguments.
 * @param plan - Sort ordering and page geometry.
 * @returns The rows this page produced.
 */
function runSearch(db, term, deep, filters, plan) {
    const candidates = searchCandidateSql(deep, filters.postingWhere);
    const sql = `WITH cand AS (
        ${candidates.sql}
         LIMIT ${exports.BROWSE_POOL})   /* backstop only — each arm is already bounded */
      SELECT ${SELECT_COLS}
        FROM cand
        JOIN corpus.postings_corpus p ON p.id = cand.id
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${filters.where}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
    const like = `%${term}%`;
    // Each arm carries the pushed-down predicate AND the term, in the order they appear in
    // its SQL. The employer arm reads its term FIRST (the company name leads its WHERE), so
    // the binding order is per-arm rather than uniform.
    const bindings = [];
    candidates.parts.forEach((part, index) => {
        const employerArm = index === 1;
        if (employerArm)
            bindings.push(like, ...filters.postingArgs);
        else
            bindings.push(...filters.postingArgs, like);
    });
    return db.prepare(sql).all(...bindings, ...filters.args, plan.per, plan.offset);
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
 * @description Runs one page through the full-text index.
 *
 *   No candidate pool and no arm bound: FTS hands back a small match set, so the filters
 *   and the ORDER BY apply directly and the LIMIT stops the walk. That is what removes
 *   BOTH the latency and the pool-shaped correctness bug — a filter here narrows the
 *   whole match, not the first 600 rows of it.
 *
 *   `q` additionally matches EMPLOYER names, which FTS does not index (company lives on
 *   the joined table), so the simple box ORs a company predicate alongside the match.
 * @param db - A handle with the shared corpus reachable as `corpus`.
 * @param expression - The FTS MATCH expression.
 * @param employer - Employer text to OR in, or '' to match on the index alone.
 * @param filters - The corpus predicate and its arguments.
 * @param plan - Sort ordering and page geometry.
 * @returns The rows this page produced.
 */
function runFullText(db, expression, employer, filters, plan) {
    // UNION inside one `IN`, never `OR`. An `OR c.name LIKE ?` beside the match forces
    // SQLite to abandon the FTS set as a driver and evaluate both halves per row: measured
    // 22.7s for `engineer` + remote, against 42ms for the union below and 32ms for the
    // match alone. The employer half is bounded because it is a LIKE over company names,
    // and its postings come back through idx_corpus_company_active.
    const employerArm = `
         UNION
        SELECT id FROM (SELECT p2.id AS id FROM corpus.companies c2
                CROSS JOIN corpus.postings_corpus p2 ON p2.company_id = c2.id
               WHERE c2.name LIKE ? AND p2.active = 1
               ORDER BY p2.id DESC LIMIT ${exports.ARM_POOL})`;
    const candidates = `SELECT rowid FROM corpus.${exports.FTS_TABLE} WHERE ${exports.FTS_TABLE} MATCH ?`
        + (employer ? employerArm : '');
    const sql = `SELECT ${SELECT_COLS}
        FROM corpus.postings_corpus p
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE p.id IN (${candidates}) AND ${filters.where}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
    const args = [expression];
    if (employer)
        args.push(`%${employer}%`);
    return db.prepare(sql).all(...args, ...filters.args, plan.per, plan.offset);
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
            jobs: [], page, per, browse: true, pooled: false, poolSize: null,
            fullText: false, deep: false,
            exhausted: true, capped,
        };
    }
    const description = param(query, 'description');
    const advancedTitle = param(query, 'title');
    const wantsText = !!(term || advancedTitle || description);
    const plan = { order, per, offset };
    // Prefer the full-text index whenever the corpus carries one; fall back to the LIKE
    // arms otherwise, so a corpus that predates it still searches (just more slowly).
    const fullText = wantsText && hasFullText(db);
    const expression = fullText ? ftsExpressionFor(query) : '';
    let jobs;
    if (fullText && expression) {
        // Ranking by rowid is ranking by ingest order, which IS "newest first" here and
        // costs nothing; the date column would re-sort the match set for the same answer.
        const ftsPlan = plan.order === exports.BROWSE_SORT_MAP.recent
            ? { ...plan, order: 'p.id DESC' } : plan;
        jobs = runFullText(db, expression, term, filters, ftsPlan);
    }
    else if (wantsText) {
        jobs = runSearch(db, term || advancedTitle, !!description, filters, plan);
    }
    else {
        jobs = runFeed(db, filters, plan);
    }
    return {
        jobs,
        page,
        per,
        browse: true,
        pooled: wantsText && !fullText,
        poolSize: wantsText && !fullText ? exports.BROWSE_POOL : null,
        fullText: fullText && !!expression,
        deep: !!description,
        exhausted: jobs.length < per,
        capped,
    };
}
// ── Full-text search ─────────────────────────────────────────────────────────
// Everything above plans around `LIKE` over a covering index, which is the best a
// corpus with no full-text index can do — and it is not good enough once a text term
// meets a narrow filter: the arm can no longer be covered, so it reads rows, and
// `nurse` + state=FL + fte measured 12-17s on the live corpus.
//
// With FTS5 the same search is 9ms, because the match no longer scans anything: the
// index hands back a small candidate set and the filters apply to that. The virtual
// table is EXTERNAL-CONTENT (`content='postings_corpus'`), so it stores only the index
// and its rowid IS the posting id — no duplicated text, and the join is a rowid lookup.
// Building it over 1.59M postings including descriptions took 62s, once.
/** @description The FTS5 table the search prefers when the corpus carries one. */
exports.FTS_TABLE = 'postings_fts';
/**
 * @description Whether this corpus has the full-text index. Probed per handle rather than
 *   cached on the module, because a corpus is replaced nightly and a stale "yes" would
 *   make every search throw rather than fall back.
 * @param db - A handle with the corpus attached.
 * @returns True when the FTS table exists and can be queried.
 */
function hasFullText(db) {
    try {
        const row = db.prepare("SELECT 1 AS ok FROM corpus.sqlite_master WHERE type='table' AND name=?").get(exports.FTS_TABLE);
        return !!row?.ok;
    }
    catch {
        return false;
    }
}
/**
 * @description Escapes a user's words into an FTS5 MATCH expression scoped to one column.
 *
 *   Every token is double-quoted, which makes it a literal string to FTS5 — so a user
 *   typing `c++`, `NOT`, `*` or an unbalanced quote gets a search for those characters
 *   rather than a syntax error or an operator they did not ask for. Tokens are ANDed,
 *   which is what "contains all of these words" means to someone using a search box.
 * @param column - The FTS column to scope to (`title` or `description`).
 * @param text - The user's raw input.
 * @returns A MATCH expression, or '' when the input carries no usable token.
 */
function ftsMatchExpression(column, text) {
    const tokens = String(text || '')
        .split(/[^\p{L}\p{N}+#]+/u)
        .map((word) => word.trim())
        .filter(Boolean)
        .slice(0, 8);
    if (!tokens.length)
        return '';
    return tokens.map((word) => `${column}:"${word.replace(/"/g, '""')}"`).join(' AND ');
}
/**
 * @description Builds the MATCH expression for a request from the three text inputs the
 *   screen offers: the simple box (`q`, titles), and the advanced title/description fields.
 * @param query - The browse request query.
 * @returns The combined MATCH expression, or '' when no full-text term was asked for.
 */
function ftsExpressionFor(query) {
    const parts = [
        ftsMatchExpression('title', param(query, 'q')),
        ftsMatchExpression('title', param(query, 'title')),
        ftsMatchExpression('description', param(query, 'description')),
    ].filter(Boolean);
    return parts.join(' AND ');
}
//# sourceMappingURL=career-browse-feed.js.map