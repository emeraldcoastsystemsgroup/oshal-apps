"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestJobsGraphForUser = ingestJobsGraphForUser;
exports.createCareerGraphRoutes = createCareerGraphRoutes;
exports.buildModel = buildModel;
exports.insights = insights;
exports.dbPaths = dbPaths;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add caller-scoped Career SQLite ingestion and graph insights for skills, industries, referrals, and recruiters.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Mirror bounded fresh postings into the owning person graph through the fail-open kernel ingestion seam.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Replace the lazy main-registrar dependency with the cycle-free user-store leaf.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Resolve graph ingestion databases through the canonical contained user-store mapper.
 */
/**
 * Career-graph routes — the first ADR-045 domain carve-out (jobs).
 *
 * Reads the caller's career-hunter sqlite (user signals + the ATTACHed shared corpus) and ingests
 * it into the caller's OWN person graph via the connector: skills (demand-weighted gaps),
 * companies + industries (from the user's scored postings), recruiters + buckets. Then answers
 * graph questions relational can't do cleanly (fit-industries with warm-referral paths, gaps by
 * market demand). Pure ADR-045 pattern: domain ingestion + NL/graph queries over /api/graph — no
 * new database. Mount under requiresAuth.
 *
 * @module career-graph-routes
 */
const express_1 = require("express");
const fs = __importStar(require("fs"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const logger_1 = require("@/shared/logger");
const graph_1 = require("@/features/graph");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-graph-routes' });
/** A url/id-safe slug. */
function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'none';
}
/** NEW-jobs window for the graph mirror — matches the nightly AI-score bound (first_seen_at is
 *  stamped at scrape/import on every row; posted_date is not, so it can never be the gate). */
const GRAPH_INGEST_FIRST_SEEN_DAYS = Math.max(1, Number(process.env.CAREER_GRAPH_INGEST_FIRST_SEEN_DAYS) || 8);
/** Per-run row cap so a backlogged corpus can never turn the fire-and-forget mirror into a
 *  multi-minute write burst (identifier-scale payloads only — kernel clips them further). */
const GRAPH_INGEST_LIMIT = Math.max(1, Number(process.env.CAREER_GRAPH_INGEST_LIMIT) || 1000);
/** Default DB opener from the dependency-leaf user store (shared corpus ATTACHed). */
function defaultOpenUserDb(sub) {
    return (0, career_user_store_1.openUserDb)(sub);
}
/**
 * @description Mirror a user's freshly-indexed jobs into their OWN person graph via the kernel's
 * ADR-045 jobs ingestion (`ingestJobsForPerson` on `@/features/graph` — kernel 85931d2a). This is
 * the package-side CALL the kernel deliberately left here: career-hunter is fully carved, so the
 * jobs-write seam (the evening scrape+index chain) lives in this package. Fail-open by contract,
 * exactly like the kernel hooks: engine-absent (ARANGO_URL unset) is a clean no-op inside the
 * kernel service, and ANY failure here (missing store, sqlite error, thrown connector) is logged
 * at ERROR and swallowed — the write chain is never blocked or failed by graph availability.
 * @param userSub - the owning user's sub (the person-graph isolation key)
 * @param openDb - injectable DB opener (tests); defaults to career-user-store's openUserDb
 * @returns resolves when the mirror completes or was skipped; NEVER rejects
 */
async function ingestJobsGraphForUser(userSub, openDb = defaultOpenUserDb) {
    try {
        if (!userSub)
            return;
        const db = openDb(userSub);
        if (!db)
            return; // store not seeded yet — nothing to mirror
        let rows;
        try {
            rows = db.prepare(`SELECT p.id, p.title, c.name AS company, p.location, p.url
           FROM corpus.postings_corpus p
           JOIN corpus.companies c ON c.id = p.company_id
          WHERE p.active = 1 AND p.first_seen_at >= datetime('now', ?)
          ORDER BY p.first_seen_at DESC
          LIMIT ?`).all(`-${GRAPH_INGEST_FIRST_SEEN_DAYS} days`, GRAPH_INGEST_LIMIT);
        }
        finally {
            try {
                db.close();
            }
            catch { /* close failure never masks the read result */ }
        }
        if (!rows.length)
            return;
        const jobs = rows.map((r) => ({
            id: r.id, title: r.title, company: r.company, location: r.location ?? null, url: r.url ?? null,
        }));
        await (0, graph_1.getGraphIngestionService)().ingestJobsForPerson(userSub, jobs);
        logger.info({ userSub, jobs: jobs.length }, 'jobs mirrored into person graph');
    }
    catch (err) {
        logger.error({ err, stack: err?.stack, userSub }, 'jobs graph ingestion failed (host flow unaffected)');
    }
}
/** Resolve graph SQLite paths through the same contained mapper as every Career route and CLI. */
function dbPaths(sub, resolvePaths = career_user_store_1.userPaths) {
    const paths = resolvePaths(sub);
    return { userPath: paths.userDb, corpusPath: paths.corpusDb };
}
/** Read the career sqlite (corpus ATTACHed) into graph nodes + edges. The user node is 'me'. */
function buildModel(userPath, corpusPath) {
    const db = new better_sqlite3_1.default(userPath, { readonly: true, fileMustExist: true });
    try {
        db.exec(`ATTACH DATABASE '${corpusPath.replace(/'/g, "''")}' AS corpus`);
        const nodes = [{ id: 'me', labels: ['user'], props: {} }];
        const edges = [];
        // Skills the market wants that the user is gapped on (demand-weighted).
        for (const g of db.prepare('SELECT key, n_jobs, avg_fit FROM gap_themes').all()) {
            nodes.push({ id: `skill:${slug(g.key)}`, labels: ['skill'], props: { key: g.key } });
            edges.push({ from: 'me', to: `skill:${slug(g.key)}`, type: 'gap', props: { n_jobs: g.n_jobs, avg_fit: g.avg_fit } });
        }
        // Recruiters grouped into their domain buckets.
        for (const r of db.prepare('SELECT id, firm, bucket, status FROM recruiter_firms').all()) {
            nodes.push({ id: `recruiter:${r.id}`, labels: ['recruiter'], props: { firm: r.firm, status: r.status } });
            if (r.bucket) {
                nodes.push({ id: `bucket:${slug(r.bucket)}`, labels: ['bucket'], props: { name: r.bucket } });
                edges.push({ from: `recruiter:${r.id}`, to: `bucket:${slug(r.bucket)}`, type: 'in_bucket' });
            }
        }
        // Companies the user has a real fit signal on (top by AI fit), with industry + warm-referral.
        const rows = db.prepare(`SELECT c.id AS cid, c.name, c.industry, c.referral,
              MAX(us.ai_fit_score) AS best_fit,
              SUM(CASE WHEN us.status='applied' THEN 1 ELSE 0 END) AS applied
       FROM user_signals us
       JOIN corpus.postings_corpus p ON p.id = us.posting_id
       JOIN corpus.companies c ON c.id = p.company_id
       WHERE us.ai_fit_score IS NOT NULL
       GROUP BY c.id ORDER BY best_fit DESC LIMIT 150`).all();
        for (const c of rows) {
            nodes.push({ id: `company:${c.cid}`, labels: ['company'], props: { name: c.name, referral: c.referral || 0 } });
            edges.push({ from: 'me', to: `company:${c.cid}`, type: 'fit', props: { score: c.best_fit } });
            if (c.applied > 0)
                edges.push({ from: 'me', to: `company:${c.cid}`, type: 'applied' });
            if (c.industry) {
                nodes.push({ id: `industry:${slug(c.industry)}`, labels: ['industry'], props: { name: c.industry } });
                edges.push({ from: `company:${c.cid}`, to: `industry:${slug(c.industry)}`, type: 'in_industry' });
            }
        }
        return { nodes, edges };
    }
    finally {
        db.close();
    }
}
/** Run the three graph-backed insight queries over the caller's person graph. */
async function insights(g) {
    const topGaps = await g.rawQuery("FOR e IN edges FILTER e.type=='gap' SORT e.props.n_jobs DESC LIMIT 10 " +
        'RETURN { skill: DOCUMENT(e._to).props.key, demand: e.props.n_jobs, avgFit: e.props.avg_fit }');
    // 2-hop: me -fit-> company -in_industry-> industry, grouped, surfacing warm-referral companies.
    const fitIndustries = await g.rawQuery("FOR fe IN edges FILTER fe.type=='fit' LET c = DOCUMENT(fe._to) " +
        "FOR ie IN edges FILTER ie._from == c._id AND ie.type=='in_industry' " +
        'COLLECT industry = DOCUMENT(ie._to).props.name INTO grp = { fit: fe.props.score, referral: c.props.referral } ' +
        'LET warm = LENGTH(grp[* FILTER CURRENT.referral > 0]) ' +
        'SORT LENGTH(grp) DESC LIMIT 10 ' +
        'RETURN { industry, companies: LENGTH(grp), warmReferralCompanies: warm, topFit: MAX(grp[*].fit) }');
    const recruiterBuckets = await g.rawQuery("FOR e IN edges FILTER e.type=='in_bucket' COLLECT bucket = DOCUMENT(e._to).props.name WITH COUNT INTO n " +
        'SORT n DESC RETURN { bucket, recruiters: n }');
    return { topGaps, fitIndustries, recruiterBuckets };
}
/**
 * @description Builds the career-graph router (mount at /api/career-hunter/graph, requiresAuth).
 * @returns an Express Router for the jobs graph carve-out
 */
function createCareerGraphRoutes() {
    const router = (0, express_1.Router)();
    const connector = (0, graph_1.createGraphConnector)();
    /** Resolve the caller's graph or write the right error and return null. */
    async function callerGraph(req, res) {
        const sub = (0, career_user_store_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return null;
        }
        if (!connector) {
            res.status(503).json({ error: 'graph_engine_unavailable' });
            return null;
        }
        return { sub, g: await connector.getPersonGraph(sub) };
    }
    /** POST /ingest — read the caller's career sqlite and (re)build their jobs graph. */
    router.post('/ingest', async (req, res) => {
        const ctx = await callerGraph(req, res);
        if (!ctx)
            return;
        const { userPath, corpusPath } = dbPaths(ctx.sub);
        if (!fs.existsSync(userPath)) {
            res.status(404).json({ error: 'no_career_data', message: 'no career-hunter data for this user' });
            return;
        }
        try {
            const { nodes, edges } = buildModel(userPath, corpusPath);
            const n = await ctx.g.upsertNodes(nodes);
            const e = await ctx.g.upsertEdges(edges);
            logger.info({ sub: ctx.sub, nodes: n, edges: e }, 'career graph ingested');
            res.json({ ok: true, nodes: n, edges: e });
        }
        catch (err) {
            logger.error({ err }, 'career graph ingest failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /insights — graph-backed answers (top gaps, fit-industries w/ warm referrals, recruiter buckets). */
    router.get('/insights', async (req, res) => {
        const ctx = await callerGraph(req, res);
        if (!ctx)
            return;
        try {
            res.json(await insights(ctx.g));
        }
        catch (err) {
            logger.error({ err }, 'career graph insights failed');
            res.status(502).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=career-graph-routes.js.map