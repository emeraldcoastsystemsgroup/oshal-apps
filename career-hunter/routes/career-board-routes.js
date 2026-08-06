"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped board reads, analytics, status updates, packet serving, and generation routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Resolve PDF and HTML packet files through symlink-safe lexical and realpath containment checks.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Mark interactive applied changes as manual assertions and expose application provenance without implying worker verification.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Upgrade unverified history to a manual assertion while retaining stronger worker or confirmation evidence on repeated applied marks.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Record every board-side applied assertion as a durable Apply V2 manual_mark before changing the SQLite projection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerBoardRoutes = registerCareerBoardRoutes;
exports.registerCareerResumeAlias = registerCareerResumeAlias;
const logger_1 = require("@/shared/logger");
const apply_run_ledger_1 = require("@/app/apply-run-ledger");
const career_board_feed_1 = require("./career-board-feed");
const career_resume_preview_1 = require("./career-resume-preview");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-board-routes' });
const ALLOWED_STATUS = new Set([
    'new', 'applied', 'dismissed', 'promoted', 'generated', 'interview', 'offer', 'deferred',
]);
function getJobs(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ jobs: [], empty: true });
        return;
    }
    const started = Date.now();
    try {
        const result = (0, career_board_feed_1.fetchBoardPage)(db, req.query);
        logger.info({
            userSub,
            sort: req.query.sort || 'ai',
            per: result.per,
            page: result.page,
            rows: result.jobs.length,
            poolSize: result.poolSize,
            ms: Date.now() - started,
        }, 'career board feed served');
        res.json(result);
    }
    catch (err) {
        logger.error({ err, userSub, ms: Date.now() - started }, 'career jobs read failed');
        res.status(500).json({ error: 'read failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'career jobs database close failed');
        }
    }
}
function getJobStats(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ byStatus: [], total: 0, empty: true });
        return;
    }
    try {
        const raw = db.prepare('SELECT status, COUNT(*) AS n FROM user_signals GROUP BY status')
            .all();
        const buckets = new Map();
        let total = 0;
        for (const row of raw) {
            const key = row.status || '(scored)';
            buckets.set(key, (buckets.get(key) || 0) + row.n);
            total += row.n;
        }
        const byStatus = [...buckets]
            .map(([status, n]) => ({ status, n }))
            .sort((left, right) => right.n - left.n);
        res.json({ byStatus, total });
    }
    catch (err) {
        logger.error({ err, userSub }, 'career jobs stats failed');
        res.status(500).json({ error: 'stats failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'career stats database close failed');
        }
    }
}
function readAnalytics(db) {
    const lane = 'FROM corpus.postings_corpus p LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.active=1 AND COALESCE(p.target_role,0)=1';
    const score = 'COALESCE(s.ai_fit_score,s.fit_score,0)';
    const pay = 'CASE WHEN p.salary_max>0 AND p.salary_max<=1000000 THEN p.salary_max END';
    const headline = db.prepare(`SELECT COUNT(*) AS inlane,
            SUM(CASE WHEN ${score}>=70 THEN 1 ELSE 0 END) AS fit70,
            SUM(CASE WHEN ${score}>=80 THEN 1 ELSE 0 END) AS fit80,
            SUM(CASE WHEN p.posted_date>=date('now','-7 days') THEN 1 ELSE 0 END) AS fresh7d,
            CAST(AVG(CASE WHEN ${score}>=70 THEN ${pay} END) AS INT) AS avg_pay_fit70,
            COUNT(DISTINCT p.company_id) AS companies ${lane}`).get();
    const funnel = db.prepare(`SELECT (SELECT COUNT(*) ${lane}) AS sourced,
            (SELECT COUNT(*) ${lane} AND ${score}>=70) AS qualified,
            (SELECT COUNT(*) FROM user_signals WHERE status='generated') AS generated,
            (SELECT COUNT(*) FROM user_signals WHERE status='applied') AS applied,
            (SELECT COUNT(*) FROM user_signals WHERE status='interview') AS interview,
            (SELECT COUNT(*) FROM user_signals WHERE status='offer') AS offer,
            (SELECT COUNT(*) FROM user_signals WHERE status='promoted') AS promoted`).get();
    const topCompanies = db.prepare(`SELECT c.name AS company, COUNT(*) AS roles, CAST(AVG(${score}) AS INT) AS avg_fit,
            MAX(COALESCE(c.referral,0)) AS referral
       FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id
       LEFT JOIN user_signals s ON s.posting_id=p.id
      WHERE p.active=1 AND COALESCE(p.target_role,0)=1
      GROUP BY c.id ORDER BY roles DESC, avg_fit DESC LIMIT 12`).all();
    const states = db.prepare(`SELECT COALESCE(NULLIF(p.state,''),'(remote/â€”)') AS state, COUNT(*) AS n
       ${lane} GROUP BY 1 ORDER BY n DESC LIMIT 12`).all();
    const salaryBands = db.prepare(`SELECT CASE WHEN ${pay} IS NULL THEN 'n/a' WHEN ${pay}<150000 THEN '<150k'
                 WHEN ${pay}<200000 THEN '150-200k' WHEN ${pay}<250000 THEN '200-250k'
                 WHEN ${pay}<350000 THEN '250-350k' ELSE '350k+' END AS band, COUNT(*) AS n
       ${lane} AND ${score}>=70 GROUP BY band ORDER BY n DESC`).all();
    return { headline, funnel, topCompanies, states, salaryBands };
}
function getAnalytics(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ empty: true });
        return;
    }
    try {
        res.json(readAnalytics(db));
    }
    catch (err) {
        logger.error({ err, userSub }, 'career analytics failed');
        res.status(500).json({ error: 'analytics failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'analytics database close failed');
        }
    }
}
function readSignalFile(userSub, postingId, kind) {
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db)
        return undefined;
    try {
        const row = db.prepare(`SELECT ${kind} AS p FROM user_signals WHERE posting_id=?`)
            .get(postingId);
        return row?.p || null;
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'resume database close failed');
        }
    }
}
function resolvePacketPath(filePath, userDir, preview = false) {
    try {
        return preview
            ? (0, career_resume_preview_1.resolvePreviewPath)(filePath, userDir)
            : (0, career_resume_preview_1.resolveContainedRegularFile)(filePath, userDir);
    }
    catch (err) {
        logger.error({ err }, 'resume artifact containment check failed');
        return null;
    }
}
function serveHtmlPreview(res, filePath, userDir) {
    const htmlPath = resolvePacketPath(filePath, userDir, true);
    if (!htmlPath) {
        res.status(404).json({ error: 'no html preview' });
        return;
    }
    try {
        res.type('html').send((0, career_resume_preview_1.buildPreviewHtml)(htmlPath));
    }
    catch (err) {
        logger.error({ err }, 'resume html preview failed');
        res.status(404).json({ error: 'no html preview' });
    }
}
function serveResumeFile(req, res, postingId) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (!Number.isFinite(postingId)) {
        res.status(400).json({ error: 'id required' });
        return;
    }
    const kind = req.query.kind === 'cover' ? 'cover_path' : 'resume_path';
    const filePath = readSignalFile(userSub, postingId, kind);
    if (filePath === undefined) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    const { userDir } = (0, career_user_store_1.userPaths)(userSub);
    const resolved = filePath ? resolvePacketPath(filePath, userDir) : null;
    if (!resolved) {
        res.status(404).json({ error: 'not found' });
        return;
    }
    if (req.query.as === 'html') {
        serveHtmlPreview(res, resolved, userDir);
        return;
    }
    res.sendFile(resolved, (err) => {
        if (err) {
            logger.error({ err }, 'resume serve failed');
            res.status(404).end();
        }
    });
}
async function updateJobStatus(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.id);
    const status = String(req.body?.status || '');
    if (!Number.isFinite(postingId) || !ALLOWED_STATUS.has(status)) {
        res.status(400).json({ error: 'bad request' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        if (status === 'applied') {
            const exists = db.prepare('SELECT 1 AS found FROM user_signals WHERE posting_id=?')
                .get(postingId);
            if (!exists) {
                res.status(404).json({ error: 'job signal not found' });
                return;
            }
            await (0, apply_run_ledger_1.recordManualApplyRun)(ctx.pool, {
                ownerSub: userSub,
                postingId,
                ticketId: `career-board-manual:${postingId}`,
                sourceRoute: 'career-board-status',
            });
        }
        const appliedAt = status === 'applied' ? "COALESCE(applied_at, datetime('now'))" : 'applied_at';
        const provenance = status === 'applied'
            ? `, application_source=CASE
          WHEN application_source IN ('verified-submission','worker-reported','manual-mark')
            THEN application_source ELSE 'manual-mark' END` : '';
        const info = db.prepare(`UPDATE user_signals SET status=@status, applied_at=${appliedAt}${provenance} WHERE posting_id=@id`).run({ status, id: postingId });
        res.json({ ok: info.changes > 0, status });
    }
    catch (err) {
        logger.error({ err, userSub, postingId }, 'career status update failed');
        res.status(500).json({ error: 'update failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'status database close failed');
        }
    }
}
function parseJsonList(value) {
    try {
        return value ? JSON.parse(String(value)) : [];
    }
    catch (err) {
        logger.warn({ err }, 'career job JSON field is malformed');
        return [];
    }
}
function getJob(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.id);
    if (!Number.isFinite(postingId)) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        const row = db.prepare(`SELECT p.*, c.name AS company, c.industry, c.homepage, c.careers_url,
              COALESCE(c.referral,0) AS referral, s.fit_score, s.ai_fit_score,
              s.ai_fit_rationale, s.ai_fit_matched, s.ai_fit_gaps, s.status,
              s.applied_at, s.promoted_at, s.generated_at, s.notes,
              s.confirmation_path, s.application_source, s.application_task_id,
              CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
              CASE WHEN s.cover_path IS NOT NULL AND s.cover_path<>'' THEN 1 ELSE 0 END AS has_cover
         FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id
         LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.id=?`).get(postingId);
        if (!row) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        row.matched = parseJsonList(row.ai_fit_matched);
        row.gaps = parseJsonList(row.ai_fit_gaps);
        res.json({ job: row });
    }
    catch (err) {
        logger.error({ err, userSub, postingId }, 'career job detail failed');
        res.status(500).json({ error: 'read failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'job database close failed');
        }
    }
}
async function generatePacket(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.id);
    if (!Number.isFinite(postingId)) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const includeOshal = req.body?.oshal === true || req.body?.oshal === 'true';
    const guidance = String(req.body?.guidance || '').trim();
    const started = await (0, career_engine_dispatch_1.runCareerCliAsync)(ctx.pool, userSub, ['tailor'], {
        CH_JOB: String(postingId),
        CH_OSHAL: includeOshal ? '1' : '',
        CH_GUIDANCE: guidance,
    });
    if ((0, career_engine_response_1.rejectEngineStart)(res, started, 'tailor'))
        return;
    res.status(202).json({ ok: true, status: 'generating' });
}
function setReferral(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const companyId = Number(req.params.id);
    const level = Math.max(0, Math.min(3, Number(req.body?.level) || 0));
    if (!Number.isFinite(companyId)) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub, false);
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        const info = db.prepare('UPDATE corpus.companies SET referral=? WHERE id=?')
            .run(level, companyId);
        res.json({ ok: info.changes > 0, level });
    }
    catch (err) {
        logger.error({ err, userSub, companyId }, 'career referral update failed');
        res.status(500).json({ error: 'update failed' });
    }
    finally {
        try {
            db.close();
        }
        catch (err) {
            logger.warn({ err }, 'referral database close failed');
        }
    }
}
/**
 * @description Registers native job-board reads and caller-owned board mutations.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for asynchronous packet generation.
 * @returns Nothing.
 */
function registerCareerBoardRoutes(router, ctx) {
    router.get('/jobs', getJobs);
    router.get('/jobs/stats', getJobStats);
    router.get('/analytics', getAnalytics);
    router.get('/resume', (req, res) => serveResumeFile(req, res, Number(req.query.id)));
    router.post('/jobs/:id/status', (req, res) => updateJobStatus(ctx, req, res));
    router.get('/jobs/:id', getJob);
    router.post('/jobs/:id/generate', (req, res) => generatePacket(ctx, req, res));
    router.post('/company/:id/referral', setReferral);
}
/**
 * @description Registers the path-shaped resume alias after static Resume Studio routes.
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
function registerCareerResumeAlias(router) {
    router.get('/resume/:id', (req, res) => serveResumeFile(req, res, Number(req.params.id)));
}
//# sourceMappingURL=career-board-routes.js.map