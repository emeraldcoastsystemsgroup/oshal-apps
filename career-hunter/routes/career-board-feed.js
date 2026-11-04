"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SORT_MAP = exports.HIGH_WIN = exports.LAND_PROB = void 0;
exports.splitBoardFilters = splitBoardFilters;
exports.buildJobFilters = buildJobFilters;
exports.fetchBoardPage = fetchBoardPage;
/**
 * CHANGE LOG
 * 24 | maintainer@emeraldcoastsystemsgroup.com | Pin explicit starred active openings ahead of ranked matches before pagination, retaining pending scores and preventing duplicate page membership.
 * 23 | maintainer@emeraldcoastsystemsgroup.com | Keep deep-page lookups driven by private signals, use stable score ties, and evaluate corpus sorts over all scored matches instead of a top-score subset.
 * 21 | maintainer@emeraldcoastsystemsgroup.com | Carry saved assessment provenance through bounded plans and retire uncalibrated hiring/clearance rankings without changing AI fit values.
 * 22 | maintainer@emeraldcoastsystemsgroup.com | Apply the same conservative workplace evidence to explicit remote filters and returned cards, including local hybrid legacy rows.
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract and replan the board feed around a bounded signal-driven candidate CTE with filter push-down and unscored tail-fill.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Use the narrow SQLite prepare/all/get contract required by the planner so canonical compilation avoids optional library types.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Document the exported query, ranking, filter, and page contracts consumed by route modules and tests.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Carry explicit application provenance and task correlation through every bounded board-feed plan.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Keep bounded pools outermost in SQLite's join order so the foreground 150-row page performs corpus primary-key lookups instead of scanning the corpus.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Drive posted-date-filtered scored pages from the corpus date index, so sparse or empty recent windows do not probe every historical user score.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Apply an owner's saved remote-or-local scope to active hunt views while keeping explicit history views accessible.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Materialize recent posting IDs from the two date indexes before owner and geographic filters; SQLite otherwise chooses the geographic active prefix and scans the entire live corpus past the native deadline.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Drive matched-board keyword searches from FTS before original-owner score lookups, so rare title/description searches cannot escalate into a historical description scan.
 * 20 | maintainer@emeraldcoastsystemsgroup.com | Add original-owner saved stars, selected-job preparation and explicit queue/status views, with conservative submission-email receipts.
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
const career_search_scope_1 = require("./career-search-scope");
const career_browse_feed_1 = require("./career-browse-feed");
const pay = require('../lib/career-pay');
const fit = require('../lib/career-fit');
const feedback = require('../lib/career-job-feedback');
/** Deprecated response keys remain null; no hiring probability or unverified qualification bonus is supplied. */
exports.LAND_PROB = 'NULL';
exports.HIGH_WIN = 'NULL';
/** @description Final ORDER BY expressions keyed by supported board sort values. */
exports.SORT_MAP = {
    ai: 's.ai_fit_score DESC, s.posting_id ASC',
    keyword: 'COALESCE(s.fit_score,0) DESC, s.posting_id ASC',
    salary: 'COALESCE(p.salary_max,0) DESC, s.posting_id ASC',
    company: 'c.name ASC, s.ai_fit_score DESC, s.posting_id ASC',
    posted: 'p.posted_date DESC NULLS LAST, s.posting_id ASC',
    recent: 'p.first_seen_at DESC, s.posting_id ASC',
    generated: 's.generated_at DESC NULLS LAST, s.posting_id ASC',
    applied: 's.applied_at DESC NULLS LAST, s.posting_id ASC',
};
/**
 * How the candidate CTE itself is ordered, per `sort=`. A sort whose key lives on `user_signals`
 * can drive the pool directly, which makes the pool an ordered prefix — truncating it cannot
 * change the answer. Sorts keyed on the corpus side (salary, posted date, company name) have no
 * such alignment, so they walk all private scores to keep every page in one exact order.
 */
const POOL_ORDER = {
    ai: 's.ai_fit_score DESC, s.posting_id ASC',
    keyword: 'COALESCE(s.fit_score,0) DESC, s.posting_id ASC',
    generated: 's.generated_at DESC NULLS LAST, s.posting_id ASC',
    applied: 's.applied_at DESC NULLS LAST, s.posting_id ASC',
};
/** Sorts whose pool ordering matches the final ordering — safe to escalate without a cap. */
const ALIGNED_SORTS = new Set(Object.keys(POOL_ORDER));
/**
 * Escalation ladder for the candidate pool. A narrow filter can leave the first rung short of a
 * full page, so the feed retries against a wider pool rather than under-reporting. Corpus-keyed
 * sorts use the complete scored set and retain signal-first primary-key corpus lookups.
 */
const POOL_STEPS = [4000, 25000];
/** Signal columns the CTE must carry so the outer SELECT and the scoring expressions still work. */
const CAND_COLS = 'posting_id, fit_score, ai_fit_score, ai_fit_rationale, ai_scored_at, ai_model, ai_input_fingerprint, status, applied_at, '
    + 'promoted_at, generated_at, notes, resume_path, cover_path, confirmation_path, '
    + 'application_source, application_task_id';
/** The board card's column list. Deliberately excludes `p.description` (1.1GB of the corpus). */
const SELECT_COLS = `p.id, p.title, c.name AS company, p.location, p.url, p.posted_date, p.first_seen_at,
        p.job_type, CASE WHEN ${(0, career_search_scope_1.fullyRemoteSql)()} THEN 1 ELSE 0 END AS remote,
        p.state, p.salary_min, p.salary_max, p.salary_currency, p.salary_period, p.salary_source, p.target_role,
        COALESCE(c.referral,0) AS referral, c.industry,
        s.fit_score, s.ai_fit_score, s.ai_fit_rationale, s.ai_scored_at, s.ai_model, s.ai_input_fingerprint,
        s.status, s.applied_at, s.promoted_at, s.generated_at, s.notes,
        s.confirmation_path, s.application_source, s.application_task_id,
        ${exports.LAND_PROB} AS land_prob, ${exports.HIGH_WIN} AS high_win,
        CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
        CASE WHEN s.cover_path  IS NOT NULL AND s.cover_path<>''  THEN 1 ELSE 0 END AS has_cover`;
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
 * @description Builds the corpus-side (postings + companies) half of the board filter set.
 *   `p.target_role = 1` replaces the old `COALESCE(p.target_role,0) = 1`: the two are equivalent
 *   for a 0/1/NULL column, but only the bare comparison is sargable, so only it can use
 *   `idx_corpus_lane (active, target_role)`.
 * @param query - The board request query.
 * @returns The composed corpus predicate and its positional bind arguments.
 */
function corpusFilters(query, scope, exclusions) {
    const g = (k) => param(query, k);
    const where = [g('status') ? '1=1' : 'p.active = 1'];
    const args = [];
    if (!g('status')) {
        const hidden = feedback.predicate(exclusions);
        if (hidden.sql) {
            where.push(hidden.sql);
            args.push(...hidden.args);
        }
    }
    if (scope && !g('status'))
        where.push((0, career_search_scope_1.jobSearchScopeSql)(scope));
    if (!g('status') && g('lane') !== 'all')
        where.push('p.target_role = 1');
    if (g('q')) {
        where.push('(p.title LIKE ? OR p.description LIKE ? OR c.name LIKE ?)');
        args.push(`%${g('q')}%`, `%${g('q')}%`, `%${g('q')}%`);
    }
    if (g('company')) {
        where.push('c.name LIKE ?');
        args.push(`%${g('company')}%`);
    }
    if (g('remote') === '1') {
        where.push(`p.remote = ? AND ${(0, career_search_scope_1.fullyRemoteSql)()}`);
        args.push(1);
    }
    if (g('remote') === '0') {
        where.push(`(p.remote = ? OR NOT ${(0, career_search_scope_1.fullyRemoteSql)()})`);
        args.push(0);
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
        where.push("(p.posted_date >= date('now', ?) OR (p.posted_date IS NULL AND p.first_seen_at >= datetime('now', ?)))");
        args.push(`-${days} days`, `-${days} days`);
    }
    const payRange = pay.payFilter(query);
    if (payRange.sql) {
        where.push(payRange.sql);
        args.push(...payRange.args);
    }
    if (g('source')) {
        where.push('c.source_lists LIKE ?');
        args.push(`%"${g('source')}"%`);
    }
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
function splitBoardFilters(query, scope, exclusions) {
    const g = (k) => param(query, k);
    const corp = corpusFilters(query, scope, exclusions);
    const scored = [];
    const scoredArgs = [];
    const tail = [];
    const tailArgs = [];
    const minScore = parseInt(g('min_score'), 10);
    if (minScore > 0) {
        scored.push('s.ai_fit_score >= ?');
        scoredArgs.push(minScore);
        tail.push('COALESCE(s.fit_score,0) >= ?');
        tailArgs.push(minScore);
    }
    if (g('status') === 'queue' || g('status') === 'tracked') {
        const states = g('status') === 'queue' ? "'promoted','generated','deferred'" : "'applied','interview','offer','rejected'";
        scored.push(`s.status IN (${states})`);
        tail.push(`s.status IN (${states})`);
    }
    else if (g('status') && g('status') !== 'saved') {
        scored.push('s.status = ?');
        scoredArgs.push(g('status'));
        tail.push('s.status = ?');
        tailArgs.push(g('status'));
    }
    else {
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
function buildJobFilters(query) {
    const p = splitBoardFilters(query);
    return {
        whereSql: [p.corpWhere, p.scoredWhere].filter(Boolean).join(' AND '),
        args: [...p.corpArgs, ...p.scoredArgs],
    };
}
/**
 * @description Runs one rung of the candidate-pool plan: a bounded, ordered walk of the user's
 *   signal rows, joined to the corpus and re-sorted into the requested order.
 * @param db - The user's signals DB with `corpus` ATTACHed.
 * @param parts - Split filter predicates.
 * @param plan - Sort ordering, page geometry and the pool bound for this rung.
 * @returns The rows this rung produced.
 */
function runPooled(db, parts, plan) {
    const bound = plan.poolN === null ? '' : `LIMIT ${plan.poolN}`;
    // Keep private signals outermost even after escalation. An ordinary join on a deep
    // or exhausted page can scan the entire description-heavy corpus through its active index.
    const join = 'CROSS JOIN';
    const sql = `WITH cand AS (
        SELECT ${CAND_COLS} FROM user_signals s
         WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere}
         ORDER BY ${plan.poolOrder} ${bound})
      SELECT ${SELECT_COLS}
        FROM cand s
        ${join} corpus.postings_corpus p ON p.id = s.posting_id
        ${join} corpus.companies c ON c.id = p.company_id
       WHERE ${parts.corpWhere}
       ORDER BY ${plan.order}
       LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...parts.scoredArgs, ...parts.corpArgs, plan.limit, plan.offset);
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
function runUnscoredTail(db, parts, limit, offset) {
    const sql = `SELECT ${SELECT_COLS}
        FROM corpus.postings_corpus p
        JOIN corpus.companies c ON c.id = p.company_id
        LEFT JOIN user_signals s ON s.posting_id = p.id
       WHERE ${parts.corpWhere} AND s.ai_fit_score IS NULL AND ${parts.tailWhere}
       LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...parts.corpArgs, ...parts.tailArgs, limit, offset);
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
function poolSaturated(db, parts, poolN) {
    const sql = `SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM user_signals s
         WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere} LIMIT ${poolN})`;
    const row = db.prepare(sql).get(...parts.scoredArgs);
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
function countScored(db, parts) {
    const sql = `WITH cand AS (
        SELECT posting_id FROM user_signals s
         WHERE s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere})
      SELECT COUNT(*) AS n
        FROM cand s
        JOIN corpus.postings_corpus p ON p.id = s.posting_id
        JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${parts.corpWhere}`;
    const row = db.prepare(sql).get(...parts.scoredArgs, ...parts.corpArgs);
    return row?.n ?? 0;
}
/**
 * @description Reads an exact scored page from the corpus when the caller has a recent-posting
 *   window. The score-first pool is fast for broad views, but when the window contains no
 *   postings it must otherwise probe every scored signal and randomly fetch each corpus row
 *   before it can prove the page is empty. The planner can use the posted-date index for dated
 *   jobs and the lane/first-seen index for newly indexed jobs whose ATS omits a posting date.
 * @param db - The user's signals DB with the shared corpus attached.
 * @param parts - The composed user-signal and corpus filters.
 * @param order - Exact requested board order.
 * @param per - Page size.
 * @param offset - Page offset.
 * @returns The exact scored rows matching the posted-date window.
 */
function runDateBounded(db, parts, order, per, offset, days) {
    // The geographic OR and active predicate can make SQLite choose idx_corpus_geo's active
    // prefix over the dates, scanning every active posting. Keep the disjoint dated/undated
    // ranges materialized and outermost, then probe the full posting and original owner's score.
    const sql = `WITH recent AS MATERIALIZED (
        SELECT id FROM corpus.postings_corpus INDEXED BY idx_corpus_posted
         WHERE posted_date >= date('now', ?)
        UNION ALL
        SELECT id FROM corpus.postings_corpus INDEXED BY idx_corpus_seen
         WHERE first_seen_at >= datetime('now', ?) AND posted_date IS NULL)
      SELECT ${SELECT_COLS}
        FROM recent r
        CROSS JOIN corpus.postings_corpus p ON p.id = r.id
        CROSS JOIN user_signals s ON s.posting_id = p.id
        CROSS JOIN corpus.companies c ON c.id = p.company_id
       WHERE ${parts.corpWhere} AND s.ai_fit_score IS NOT NULL AND ${parts.scoredWhere}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(`-${days} days`, `-${days} days`, ...parts.corpArgs, ...parts.scoredArgs, per, offset);
}
/**
 * @description Plans and runs the board feed for one request. Walks the pool ladder until the page
 *   is full, then backfills from unscored postings if the scored candidates ran out.
 * @param db - The user's signals DB with the shared corpus ATTACHed.
 * @param query - The board request query (filters, `sort`, `per`, `page`).
 * @returns The page of job cards plus the plan that produced it.
 */
/** Starred openings are a stable prefix across the entire paginated board, including pending scores. */
function fetchBoardPage(db, query, scope, selectedIds, exclusions, favoriteIds = []) {
    const favorites = [...new Set(favoriteIds.filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 2000);
    let result;
    if (!param(query, 'status') && favorites.length) {
        const per = Math.min(Math.max(Math.trunc(Number(query.per)) || 120, 1), 300), page = Math.max(1, Math.trunc(Number(query.page)) || 1), offset = (page - 1) * per;
        // Explicit saves remain visible outside the matching area's age/radius defaults.
        // Keyword, pay and workplace filters still apply; application history stays in Status.
        const parts = splitBoardFilters({ ...query, days: '' }, null, exclusions);
        const order = exports.SORT_MAP[String(query.sort)] || exports.SORT_MAP.ai;
        const pinned = db.prepare(`SELECT ${SELECT_COLS} FROM user_signals s
      CROSS JOIN corpus.postings_corpus p ON p.id=s.posting_id
      CROSS JOIN corpus.companies c ON c.id=p.company_id
      WHERE s.posting_id IN (${favorites.map(() => '?').join(',')})
        AND COALESCE(s.status,'') NOT IN ('dismissed','applied','interview','offer','rejected')
        AND ${parts.scoredWhere} AND ${parts.corpWhere}
      ORDER BY ${order}`).all(...favorites, ...parts.scoredArgs, ...parts.corpArgs);
        const head = pinned.slice(offset, offset + per), remaining = per - head.length;
        const tail = fetchBoardPageRaw(db, query, scope, selectedIds, exclusions, { offset: Math.max(0, offset - pinned.length), per: remaining + 1, exclude: pinned.map(j => Number(j.id)) });
        result = { ...tail, jobs: [...head, ...tail.jobs.slice(0, remaining)], page, per,
            exhausted: offset + per >= pinned.length && tail.jobs.length <= remaining,
            starredFirst: true, starredCount: pinned.length };
    }
    else
        result = fetchBoardPageRaw(db, query, scope, selectedIds, exclusions);
    result.jobs = result.jobs.map(job => fit.decorateFit(pay.decoratePay(job, query)));
    return result;
}
function fetchBoardPageRaw(db, query, scope, selectedIds, exclusions, window) {
    const requestedSort = String(query.sort || 'ai');
    // Old bookmarks receive the actual AI-fit order, with its aligned indexed pool.
    const sort = ['prob', 'highwin'].includes(requestedSort) ? 'ai' : requestedSort;
    const order = param(query, 'status') === 'queue' && sort === 'generated'
        ? "MAX(COALESCE(julianday(s.promoted_at),0),COALESCE(julianday(s.generated_at),0)) DESC, s.posting_id DESC" : exports.SORT_MAP[sort] || exports.SORT_MAP.ai;
    const poolOrder = POOL_ORDER[sort] || POOL_ORDER.ai;
    const per = window?.per ?? Math.min(Math.max(Number(query.per) || 120, 1), 300);
    const page = Math.max(1, Number(query.page) || 1);
    const offset = window?.offset ?? (page - 1) * per;
    const includeUnscored = param(query, 'include_unscored') === '1';
    const expression = (0, career_browse_feed_1.ftsExpressionFor)({ q: param(query, 'q') });
    const indexedKeywords = !includeUnscored && !!expression && (0, career_browse_feed_1.hasFullText)(db) && selectedIds === undefined;
    const parts = splitBoardFilters(indexedKeywords ? { ...query, q: '' } : query, scope, exclusions);
    if (window?.exclude.length) {
        const omit = `s.posting_id NOT IN (${window.exclude.map(() => '?').join(',')})`;
        parts.scoredWhere += ' AND ' + omit;
        parts.scoredArgs.push(...window.exclude);
        parts.tailWhere += ' AND ' + omit.replace(/s\.posting_id/g, 'p.id');
        parts.tailArgs.push(...window.exclude);
    }
    const workflow = !!param(query, 'status');
    const selected = selectedIds === undefined ? null : selectedIds.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 2000);
    if (selected && selected.length === 0)
        return { jobs: [], page, per, poolSize: null, exhausted: true, pooled: false, scoredOnly: false };
    const selectedSql = selected ? ` AND s.posting_id IN (${selected.map(() => '?').join(',')})` : '';
    if (indexedKeywords) {
        const sql = `WITH keywords AS MATERIALIZED (
          SELECT rowid AS posting_id FROM corpus.${career_browse_feed_1.FTS_TABLE} WHERE ${career_browse_feed_1.FTS_TABLE} MATCH ? UNION SELECT p.id FROM corpus.companies c CROSS JOIN corpus.postings_corpus p ON p.company_id=c.id WHERE c.name LIKE ?)
        SELECT ${SELECT_COLS}
          FROM keywords k
          CROSS JOIN user_signals s ON s.posting_id = k.posting_id
          CROSS JOIN corpus.postings_corpus p ON p.id = s.posting_id
          CROSS JOIN corpus.companies c ON c.id = p.company_id
         WHERE ${workflow ? '1=1' : 's.ai_fit_score IS NOT NULL'} AND ${parts.scoredWhere} AND ${parts.corpWhere}${selectedSql}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`;
        const jobs = db.prepare(sql).all(expression, '%' + param(query, 'q') + '%', ...parts.scoredArgs, ...parts.corpArgs, ...(selected || []), per, offset);
        return { jobs, page, per, poolSize: null, exhausted: jobs.length < per, pooled: false, scoredOnly: !workflow };
    }
    if (workflow) {
        const sql = `SELECT ${SELECT_COLS} FROM user_signals s
      CROSS JOIN corpus.postings_corpus p ON p.id=s.posting_id
      CROSS JOIN corpus.companies c ON c.id=p.company_id
      WHERE ${parts.scoredWhere} AND ${parts.corpWhere}${selectedSql}
      ORDER BY ${order} LIMIT ? OFFSET ?`;
        const jobs = db.prepare(sql).all(...parts.scoredArgs, ...parts.corpArgs, ...(selected || []), per, offset);
        return { jobs, page, per, poolSize: null, exhausted: jobs.length < per, pooled: false, scoredOnly: false };
    }
    // A posted-date window can leave the user's scored set empty even when it contains 100K+
    // historical scores. Probe only that bounded corpus range instead of walking every score and
    // joining each signal to a random row in the multi-gigabyte corpus.
    const hasPostedWindow = parseInt(param(query, 'days'), 10) > 0;
    if (hasPostedWindow && !includeUnscored) {
        const jobs = runDateBounded(db, parts, order, per, offset, parseInt(param(query, 'days'), 10));
        return {
            jobs, page, per, poolSize: null, exhausted: jobs.length < per,
            pooled: false, scoredOnly: true,
        };
    }
    // Deep pages need a pool at least as large as the window they read from.
    const need = offset + per;
    const ladder = ALIGNED_SORTS.has(sort) ? POOL_STEPS.filter((n) => n >= need) : [null];
    if (!ladder.length)
        ladder.push(Math.max(need * 4, POOL_STEPS[POOL_STEPS.length - 1]));
    if (ALIGNED_SORTS.has(sort))
        ladder.push(null); // exhaustive walk is exact for pool-aligned sorts
    let jobs = [];
    let poolSize = ladder[0];
    for (const poolN of ladder) {
        poolSize = poolN;
        jobs = runPooled(db, parts, { order, poolOrder, poolN, limit: per, offset });
        if (jobs.length >= per)
            break;
        // A short page is only worth retrying wider if this rung was actually full.
        if (poolN === null || !poolSaturated(db, parts, poolN))
            break;
    }
    const exhausted = jobs.length < per;
    // Unscored postings are OPT-IN (`include_unscored=1`), not the default. Finding them means
    // scanning the corpus for rows the user has no signal for, and that scan cannot terminate early
    // when few match — measured 8.0s (state=WY) and 21.6s (min_score=90 + remote) against 12-320ms
    // for the same filters over scored candidates. Since an unscored posting carries no fit score,
    // it has no position in a ranked board anyway; the surface reports `exhausted` instead, and the
    // caller who genuinely wants the exhaustive set can ask for it and wait.
    if (exhausted && includeUnscored) {
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
//# sourceMappingURL=career-board-feed.js.map
