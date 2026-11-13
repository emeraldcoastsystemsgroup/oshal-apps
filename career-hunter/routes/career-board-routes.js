"use strict";
/**
 * CHANGE LOG
 * 33 | maintainer@emeraldcoastsystemsgroup.com | Persist removal as one relationship tombstone and derive saved membership from that status without rewriting board receipts.
 * 32 | maintainer@emeraldcoastsystemsgroup.com | Apply default-off owner preparation choices in the real save writer and accept exact-document review without marking submission.
 * 28 | maintainer@emeraldcoastsystemsgroup.com | Forward optional 7d/30d/90d period window query (?days=) to readAnalytics on GET /analytics.
 * 27 | maintainer@emeraldcoastsystemsgroup.com | Correct only an explicit mistaken manual submission mark through the original-owner write lease, retaining audit history and refusing actual submission evidence.
 * 26 | maintainer@emeraldcoastsystemsgroup.com | Read and revise owner-private additional experience, validate exact per-application selections, and pass explicit saved priorities to board pagination.
 * 25 | maintainer@emeraldcoastsystemsgroup.com | Persist reversible original-owner Not interested feedback through the existing status permission and apply it before feed pagination.
 * 23 | maintainer@emeraldcoastsystemsgroup.com | Return original-owner assessment date/model evidence on job polling and mark retired derived ranks null.
 * 24 | maintainer@emeraldcoastsystemsgroup.com | Normalize the read-only job's remote display with the same workplace evidence used by board and public filters.
 * 22 | maintainer@emeraldcoastsystemsgroup.com | Serve full exact private employer context with job details against the read-only corpus.
 * 21 | maintainer@emeraldcoastsystemsgroup.com | Reconcile exact native submission evidence under the existing original-person mailbox schedule before checking employer updates.
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted caller-scoped board reads, analytics, status updates, packet serving, and generation routes.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Resolve PDF and HTML packet files through symlink-safe lexical and realpath containment checks.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Mark interactive applied changes as manual assertions and expose application provenance without implying worker verification.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Upgrade unverified history to a manual assertion while retaining stronger worker or confirmation evidence on repeated applied marks.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Record every board-side applied assertion as a durable Apply V2 manual_mark before changing the SQLite projection.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | DELETE /jobs/:id/packet (1.26.0): discard the caller's own generated packet through the engine's `packet-remove` in the leased child that owns the store (the packet folder under the caller's applications directory and the caller's own per-posting row, returned to unworked). 404 when the caller has no packet for the posting, 409 once the posting is applied or later (its packet is the application record). Until now a packet could be regenerated but never discarded.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Expose native summary counters from actual applied and interview status buckets.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | The Insights BY STATE label for a posting with no state showed a twice-encoded em dash (its UTF-8 bytes saved again as Latin-1 text). The SQL now names the em dash as an ASCII escape, so the label is "(remote/—)" whatever the file encoding. Guard: tests/career-insights-state-label.test.mjs.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | GET /analytics reads through career-insights.ts (covering indexes, one pass of the caller's scores); live 2026-10-12 the five corpus-row aggregates stalled past the kernel's 10 s frame deadline on a cold page cache (503, Insights all zeros). A corpus without the Insights index answers 503 with a plain reason at once instead of scanning.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Add an owner-scoped preview + count-checked permanent purge for generated packets older than seven days. The engine removes only that user's generated packet directories and match/application rows, leaving other statuses and the shared corpus intact.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Read the caller's saved matching area for the board without changing independent job browsing.
 * 20 | maintainer@emeraldcoastsystemsgroup.com | Add original-owner saved stars, selected-job preparation and explicit queue/status views, with conservative submission-email receipts.
 * 22 | maintainer@emeraldcoastsystemsgroup.com | Return the same derived score metrics on job polling as the board feed so a regenerated packet refreshes its visible fit without reloading the board.
 * 29 | maintainer@emeraldcoastsystemsgroup.com | Persist original-owner manual interview times, offers and closed outcomes through the status route, with validated explicit time zones and a retained manual receipt.
 * 30 | maintainer@emeraldcoastsystemsgroup.com | Report exact actionable match counts with the same owner scope as the match page, separately from saved and application history; unreadable scope remains unknown.
 * 31 | maintainer@emeraldcoastsystemsgroup.com | Register full original-owner application progress before dynamic posting routes and extract existing update handlers to keep the registrar bounded without changing their behavior.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerBoardRoutes = registerCareerBoardRoutes;
exports.registerCareerResumeAlias = registerCareerResumeAlias;
const logger_1 = require("@/shared/logger");
const career_match_prefs_1 = require("./career-match-prefs");
const apply_run_ledger_1 = require("@/app/apply-run-ledger");
const career_board_feed_1 = require("./career-board-feed");
const career_search_scope_1 = require("./career-search-scope");
const career_resume_preview_1 = require("./career-resume-preview");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_targets_1 = require("./career-targets");
const career_user_store_1 = require("./career-user-store");
const career_insights_1 = require("./career-insights");
const crypto_1 = require("crypto");
const career_engine_runner_1 = require("./career-engine-runner");
const boardState = require('../lib/career-board-state');
const applicationDraft = require('../lib/career-application-draft');
const workflowRoutes = require('../lib/career-workflow-routes');
const applicationWorkflow = require('../lib/career-application-workflow');
const manualSubmission = require('../lib/career-manual-submission');
const feedback = require('../lib/career-job-feedback');
const experienceBank = require('../lib/career-experience-bank');
const career_surface_routes_1 = require("./career-surface-routes");
const career_progress_1 = require("./career-progress");
const pay = require('../lib/career-pay');
const fit = require('../lib/career-fit');
const emailUpdates = require('../lib/career-email-updates');
const logger = (0, logger_1.createChildLogger)({ module: 'career-board-routes' });
const ALLOWED_STATUS = new Set([
    'new', 'applied', 'dismissed', 'promoted', 'generated', 'interview', 'offer', 'deferred', 'rejected',
]);
/** @description Apply the standing remote default only when the caller did not choose a workplace filter; explicit matches refuse unreadable preferences. @param ctx Package context. @param userSub Original owner. @param input Query fields. @returns Caller query with its effective workplace preference. */
async function matchedBoardQuery(ctx, userSub, input) {
    const query = { ...input };
    if (!query.status && query.remote === undefined && await (0, career_match_prefs_1.readRemoteOnly)(ctx.pool, userSub, { strict: query.matches === '1' }))
        query.remote = '1';
    return query;
}
async function getJobs(ctx, req, res) {
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
        const query = await matchedBoardQuery(ctx, userSub, req.query);
        const state = boardState.readBoardState((0, career_user_store_1.userPaths)(userSub).userDir);
        const currentQueue = Object.entries(state.jobs).filter(([, value]) => value.favorite || value.workflowEnteredAt || value.applicationDraft).map(([id]) => Number(id));
        const result = (0, career_board_feed_1.fetchBoardPage)(db, query, (0, career_search_scope_1.readJobSearchScope)((0, career_user_store_1.userPaths)(userSub).userDir), query.status === 'saved' ? boardState.favoriteIds(state, db) : query.status === 'queue' && query.current === '1' ? currentQueue : undefined, feedback.read((0, career_user_store_1.userPaths)(userSub).userDir), boardState.favoriteIds(state, db));
        const emails = emailUpdates.read((0, career_user_store_1.userPaths)(userSub).userDir);
        result.jobs = result.jobs.map(job => workflowRoutes.decorate(db, (0, career_user_store_1.userPaths)(userSub).userDir, emailUpdates.decorate(emails, boardState.decorateJob(state, job))));
        logger.info({
            userSub,
            sort: req.query.sort || 'ai',
            per: result.per,
            page: result.page,
            rows: result.jobs.length,
            poolSize: result.poolSize,
            ms: Date.now() - started,
        }, 'career board feed served');
        res.json({ ...result, exclusions: feedback.read((0, career_user_store_1.userPaths)(userSub).userDir) });
    }
    catch (err) {
        if (err instanceof pay.PayRangeError) {
            const failure = err;
            res.status(400).json({ error: failure.code, message: failure.message });
            return;
        }
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
/** @description Read the owner's existing status buckets without confusing pipeline records with new matches. @param db Owner database. @returns Bucket totals and labels. */
function statusBuckets(db) {
    const raw = db.prepare('SELECT status, COUNT(*) AS n FROM user_signals GROUP BY status').all();
    const buckets = new Map();
    let total = 0;
    for (const row of raw) {
        const key = row.status || '(scored)';
        buckets.set(key, (buckets.get(key) || 0) + row.n);
        total += row.n;
    }
    const byStatus = [...buckets].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
    return { buckets, total, byStatus };
}
/** @description Keep known pipeline counts when matching preferences or area cannot be read, without inventing a zero. @param ctx Package context. @param userSub Original owner. @param db Owner database. @param state Owner saved state. @returns Exact count or unknown. */
async function matchCount(ctx, userSub, db, state) {
    try {
        const remote = await (0, career_match_prefs_1.readRemoteOnly)(ctx.pool, userSub, { strict: true }) ? '1' : '';
        return (0, career_board_feed_1.countNewMatches)(db, { remote }, (0, career_search_scope_1.readJobSearchScope)((0, career_user_store_1.userPaths)(userSub).userDir), boardState.favoriteIds(state, db), feedback.read((0, career_user_store_1.userPaths)(userSub).userDir));
    }
    catch (error) {
        logger.warn({ error, userSub }, 'career match count unavailable');
        return null;
    }
}
/** @description Read actual saved/pipeline activity and the separate actionable-match set for this owner. @param ctx Package context. @param req Caller request. @param res Response. @returns Completion. */
async function getJobStats(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ byStatus: [], total: 0, applied: 0, interviewing: 0, saved: 0, queued: 0, tracked: 0, matches: 0, empty: true });
        return;
    }
    try {
        const { buckets, total, byStatus } = statusBuckets(db), applied = buckets.get('applied') || 0, interviewing = buckets.get('interview') || 0;
        const state = boardState.readBoardState((0, career_user_store_1.userPaths)(userSub).userDir), ids = Object.entries(state.jobs).filter(([, value]) => value.favorite || value.workflowEnteredAt || value.applicationDraft).map(([id]) => Number(id));
        const queued = ids.length ? Number(db.prepare(`SELECT COUNT(*) AS n FROM user_signals WHERE status IN ('promoted','generated','deferred') AND posting_id IN (${ids.map(() => '?').join(',')})`).get(...ids).n) : 0;
        const matches = await matchCount(ctx, userSub, db, state);
        res.json({ byStatus, total, applied, interviewing, queued, matches, tracked: applied + interviewing + (buckets.get('offer') || 0) + (buckets.get('rejected') || 0),
            earlierPreparation: Math.max(0, (buckets.get('promoted') || 0) + (buckets.get('generated') || 0) + (buckets.get('deferred') || 0) - queued), saved: boardState.favoriteIds(state, db).length });
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
    const rawDays = Number(req.query.days);
    const windowDays = [7, 30, 90].includes(rawDays) ? rawDays : undefined;
    try {
        res.json((0, career_insights_1.readAnalytics)(db, windowDays));
    }
    catch (err) {
        if (err instanceof career_insights_1.InsightsNotReady) {
            logger.warn({ userSub, reason: err.code }, 'career analytics refused: insights index missing');
            res.status(503).json({ error: err.message, reason: err.code });
            return;
        }
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
    res.setHeader('Cache-Control', 'private, no-store');
    const resolved = filePath ? resolvePacketPath(filePath, userDir) : null;
    if (req.query.submitted === '1') {
        try {
            const queued = require('../lib/career-submission-queue'), native = require('../lib/career-submission-native'), saved = Object.values(queued.read(userDir).items).filter((value) => value.postingId === postingId && value.status === 'submitted').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            if (saved) {
                const input = native.snapshot(userDir, saved.id), name = kind === 'cover_path' ? 'CoverLetter.pdf' : 'Resume_ATS.pdf', bytes = Buffer.from(input.task.documents[name], 'base64');
                const expected = kind === 'cover_path' ? saved.coverSha256 : saved.resumeSha256;
                if (queued.digest(bytes) !== expected) {
                    res.status(409).json({ error: 'Submitted document evidence changed.' });
                    return;
                }
                if (req.query.as !== 'html') {
                    res.type('pdf').send(bytes);
                    return;
                }
                if (!resolved || queued.digest(require('fs').readFileSync(resolved)) !== expected) {
                    res.status(404).json({ error: 'The exact submitted HTML is unavailable. Download the retained PDF.' });
                    return;
                }
            }
        }
        catch (error) {
            logger.error({ err: error }, 'submitted document read failed');
            res.status(409).json({ error: 'Submitted document evidence unavailable.' });
            return;
        }
    }
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
/** Validate a supplied interview instant without guessing the browser's time zone. */
function interviewInstant(value, status) {
    if (value === undefined)
        return undefined;
    if (status !== 'interview' || typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
        return null;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number), at = Date.parse(value);
    if (!Number.isFinite(at) || Number(value.slice(11, 13)) > 23
        || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value.slice(0, 10))
        return null;
    return new Date(at).toISOString();
}
/** Keep the existing durable manual submission admission ahead of the SQLite projection. */
async function recordApplied(ctx, db, userSub, postingId) {
    if (!db.prepare('SELECT 1 AS found FROM user_signals WHERE posting_id=?').get(postingId))
        return false;
    await (0, apply_run_ledger_1.recordManualApplyRun)(ctx.pool, { ownerSub: userSub, postingId, ticketId: `career-board-manual:${postingId}`, sourceRoute: 'career-board-status' });
    return true;
}
/** Publish the SQL status and original-owner board receipt together in the request's generation. */
function persistStatus(db, userDir, postingId, status, favorite, interviewAt) {
    db.prepare('BEGIN IMMEDIATE').run();
    db.prepare('INSERT OR IGNORE INTO user_signals(posting_id) VALUES(?)').run(postingId);
    const appliedAt = status === 'applied' ? "COALESCE(applied_at, datetime('now'))" : 'applied_at';
    const provenance = status === 'applied'
        ? `, application_source=CASE WHEN application_source IN ('verified-submission','worker-reported','manual-mark') THEN application_source ELSE 'manual-mark' END` : '';
    if (status)
        db.prepare(`UPDATE user_signals SET status=@status, applied_at=${appliedAt},
    promoted_at=${status === 'promoted' ? "COALESCE(promoted_at,datetime('now'))" : 'promoted_at'}${provenance}
    ${interviewAt !== undefined ? ', interview_at=@interviewAt' : ''} WHERE posting_id=@id`)
            .run({ status, id: postingId, ...(interviewAt !== undefined ? { interviewAt } : {}) });
    const patch = {}, current = boardState.readBoardState(userDir).jobs[postingId] || {};
    if (typeof favorite === 'boolean')
        patch.favorite = favorite;
    if (status === 'promoted') {
        patch.favorite = true;
        if (!current.workflow) {
            patch.phase = 'queued';
            patch.error = null;
            patch.completedAt = null;
        }
        patch.workflowEnteredAt = current.workflowEnteredAt || new Date().toISOString();
    }
    if (patch.favorite === true)
        patch.savedAt = current.savedAt || new Date().toISOString();
    if (status === 'dismissed')
        patch.favorite = false;
    if (['interview', 'offer', 'rejected'].includes(status))
        patch.manualTracking = { status, recordedAt: new Date().toISOString(),
            ...(status === 'interview' ? { interviewAt: interviewAt ?? current.manualTracking?.interviewAt ?? null } : {}) };
    const saved = boardState.updateBoardState(userDir, postingId, patch);
    db.prepare('COMMIT').run();
    return { ok: true, status, favorite: saved.favorite === true };
}
/** Parse one existing status mutation before opening a writable owner store. */
function statusInput(req) {
    const postingId = Number(req.params.id), status = typeof req.body?.status === 'string' ? req.body.status : '';
    const favorite = req.body?.favorite, draftInput = req.body?.draft, draftMutation = draftInput !== undefined;
    const reviewInput = req.body?.applicationReview, reviewMutation = reviewInput !== undefined;
    const correction = req.body?.correction, undoManual = correction === 'undo-manual-submission';
    const interviewAt = interviewInstant(req.body?.interview_at, status);
    if (interviewAt === null)
        throw Error('Choose a valid interview date and time with its time zone.');
    if (!Number.isSafeInteger(postingId) || postingId <= 0 || (status && !ALLOWED_STATUS.has(status))
        || (favorite !== undefined && typeof favorite !== 'boolean') || (correction !== undefined && !undoManual)
        || (undoManual && (status || favorite !== undefined || req.body?.feedback || draftMutation))
        || (reviewMutation && (status || favorite !== undefined || req.body?.feedback || correction !== undefined || draftMutation))
        || (draftMutation && (status || favorite !== undefined || req.body?.feedback || correction !== undefined))
        || (!status && typeof favorite !== 'boolean' && !req.body?.feedback && !undoManual && !draftMutation && !reviewMutation))
        throw Error('bad request');
    return { postingId, status, favorite, interviewAt, draftInput, draftMutation, undoManual, reviewInput, reviewMutation };
}
/** Apply the same draft, correction, feedback and application admission rules to the admitted owner. */
async function applyStatus(ctx, req, res, db, userSub, input) {
    const { postingId, favorite, interviewAt, draftInput, draftMutation, undoManual } = input;
    let { status } = input;
    const posting = db.prepare('SELECT p.id,p.title,p.location,c.name AS company FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id WHERE p.id=?').get(postingId);
    if (posting && req.body?.feedback) {
        const exclusions = feedback.update((0, career_user_store_1.userPaths)(userSub).userDir, req.body.feedback, posting);
        res.json({ ok: true, exclusions });
        return;
    }
    if (!posting) {
        res.status(404).json({ error: 'posting not found' });
        return;
    }
    if (undoManual) {
        res.json(manualSubmission.undoManualSubmission(db, (0, career_user_store_1.userPaths)(userSub).userDir, postingId, req.body.reason));
        return;
    }
    const signal = db.prepare('SELECT s.status,s.resume_path,s.cover_path,p.url,p.active FROM corpus.postings_corpus p LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.id=?').get(postingId);
    if (input.reviewMutation) {
        res.json(applicationWorkflow.review((0, career_user_store_1.userPaths)(userSub).userDir, postingId, { ...signal, has_resume: !!signal?.resume_path, has_cover: !!signal?.cover_path }, input.reviewInput));
        return;
    }
    if (draftMutation) {
        const record = { ...signal, status: signal?.status, has_resume: !!signal?.resume_path, has_cover: !!signal?.cover_path };
        res.json({ ok: true, application: applicationDraft[draftInput?.restore === true ? 'restore' : 'save']((0, career_user_store_1.userPaths)(userSub).userDir, postingId, record, draftInput) });
        return;
    }
    if (!status && favorite === true && signal?.status === 'dismissed')
        status = 'new';
    if (status && ['applied', 'interview', 'offer', 'rejected'].includes(signal?.status || '') && ['new', 'promoted', 'generated', 'deferred'].includes(status)) {
        res.status(409).json({ error: 'A submitted application cannot return to document preparation.' });
        return;
    }
    if (status === 'applied' && !await recordApplied(ctx, db, userSub, postingId)) {
        res.status(404).json({ error: 'job signal not found' });
        return;
    }
    if (status === 'dismissed') {
        const changed = db.prepare("UPDATE user_signals SET status='dismissed' WHERE posting_id=?").run(postingId);
        if (!changed.changes)
            db.prepare("INSERT INTO user_signals(posting_id,status)VALUES(?,'dismissed')").run(postingId);
        res.json({ ok: true, status: 'dismissed', favorite: false });
        return;
    }
    const result = persistStatus(db, (0, career_user_store_1.userPaths)(userSub).userDir, postingId, status, favorite, interviewAt);
    const preparation = (favorite === true || status === 'promoted') ? await workflowRoutes.prepareSaved(ctx, userSub, [postingId], career_engine_dispatch_1.runCareerCliAsync) : null;
    res.json({ ...result, ...(preparation ? { preparation } : {}) });
}
async function updateJobStatus(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    let input;
    try {
        input = statusInput(req);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(userSub, false), postingId = input.postingId;
    if (!db) {
        res.status(404).json({ error: 'no data' });
        return;
    }
    try {
        await applyStatus(ctx, req, res, db, userSub, input);
    }
    catch (err) {
        try {
            db.prepare('ROLLBACK').run();
        }
        catch (_) { /* No transaction remains after commit. */ }
        if ([400, 409, 503].includes(err.status || 0)) {
            res.status(err.status).json({ error: err.message });
            return;
        }
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
async function getJob(req, res) {
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
        const row = db.prepare(`SELECT p.*, CASE WHEN ${(0, career_search_scope_1.fullyRemoteSql)()} THEN 1 ELSE 0 END AS remote,
              c.name AS company, c.industry, c.homepage, c.careers_url,
              COALESCE(c.referral,0) AS referral, s.fit_score, s.ai_fit_score,
              s.ai_fit_rationale, s.ai_fit_matched, s.ai_fit_gaps, s.ai_scored_at, s.ai_model, s.ai_input_fingerprint, s.status,
              s.applied_at, s.promoted_at, s.generated_at, s.interview_at, s.notes, s.resume_path, s.cover_path,
              s.confirmation_path, s.application_source, s.application_task_id,
              ${career_board_feed_1.LAND_PROB} AS land_prob, ${career_board_feed_1.HIGH_WIN} AS high_win,
              CASE WHEN s.resume_path IS NOT NULL AND s.resume_path<>'' THEN 1 ELSE 0 END AS has_resume,
              CASE WHEN s.cover_path IS NOT NULL AND s.cover_path<>'' THEN 1 ELSE 0 END AS has_cover
         FROM corpus.postings_corpus p JOIN corpus.companies c ON c.id=p.company_id
         LEFT JOIN user_signals s ON s.posting_id=p.id WHERE p.id=?`).get(postingId);
        if (!row) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        Object.assign(row, require('../lib/career-job-context').applyJobContext((0, career_user_store_1.userPaths)(userSub).userDir, row));
        row.matched = parseJsonList(row.ai_fit_matched);
        row.gaps = parseJsonList(row.ai_fit_gaps);
        res.setHeader('Cache-Control', 'private, no-store');
        const application = applicationDraft.view((0, career_user_store_1.userPaths)(userSub).userDir, postingId, row);
        delete row.resume_path;
        delete row.cover_path;
        res.json({ job: { ...emailUpdates.decorate(emailUpdates.read((0, career_user_store_1.userPaths)(userSub).userDir), boardState.decorateJob(boardState.readBoardState((0, career_user_store_1.userPaths)(userSub).userDir), fit.decorateFit(pay.decoratePay(row)))), application },
            processing: !!(await (0, career_engine_runner_1.nativeRunInProgress)()) });
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
    if (!Number.isSafeInteger(postingId) || postingId <= 0) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const includeOshal = req.body?.oshal === true || req.body?.oshal === 'true';
    const experienceIds = req.body?.experienceIds ?? (includeOshal ? [experienceBank.LEGACY] : []);
    let bank;
    try {
        const current = experienceBank.read((0, career_user_store_1.userPaths)(userSub).userDir);
        bank = experienceBank.selection((0, career_user_store_1.userPaths)(userSub).userDir, experienceIds, req.body?.experienceRevision || (includeOshal ? current.revision : undefined));
    }
    catch (error) {
        res.status(error.status || 503).json({ error: error.message });
        return;
    }
    const guidance = String(req.body?.guidance || '').trim();
    if (guidance.length > 2000) {
        res.status(400).json({ error: 'Keep application guidance within 2,000 characters.' });
        return;
    }
    const requestId = typeof req.body?.requestId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(req.body.requestId) ? req.body.requestId : (0, crypto_1.randomUUID)();
    const documents = req.body?.documents !== false;
    try {
        const db = (0, career_user_store_1.openUserDb)(userSub);
        if (!db) {
            res.status(404).json({ error: 'Upload a résumé first.' });
            return;
        }
        let job;
        try {
            job = db.prepare('SELECT status,resume_path,cover_path,CASE WHEN resume_path IS NOT NULL AND resume_path<>\'\' THEN 1 ELSE 0 END AS has_resume,CASE WHEN cover_path IS NOT NULL AND cover_path<>\'\' THEN 1 ELSE 0 END AS has_cover FROM user_signals WHERE posting_id=?').get(postingId) || {};
        }
        finally {
            db.close();
        }
        applicationDraft.begin((0, career_user_store_1.userPaths)(userSub).userDir, postingId, job, { revision: req.body?.draftRevision, guidance, experienceIds, experienceRevision: bank.revision }, requestId, documents);
    }
    catch (error) {
        res.status(error.status || 503).json({ error: error.message });
        return;
    }
    const started = await (0, career_engine_dispatch_1.runCareerCliAsync)(ctx.pool, userSub, ['prepare-job'], {
        CH_JOB: String(postingId),
        CH_OSHAL: '',
        CH_EXPERIENCE_IDS: JSON.stringify(experienceIds),
        CH_EXPERIENCE_REVISION: bank.revision,
        CH_GUIDANCE: guidance,
        CH_DOCUMENTS: req.body?.documents === false ? '0' : '1',
        CH_REQUEST_ID: requestId,
    });
    if (!started.started && documents)
        applicationDraft.refused((0, career_user_store_1.userPaths)(userSub).userDir, postingId, requestId);
    if ((0, career_engine_response_1.rejectEngineStart)(res, started, 'tailor'))
        return;
    res.status(202).json({ ok: true, status: req.body?.documents === false ? 'scoring' : 'generating', requestId });
}
/** HTTP status for each refusal code the engine's packets.remove returns. */
const PACKET_REFUSAL_STATUS = { 'not-found': 404, conflict: 409 };
/**
 * @description DELETE /jobs/:id/packet — discard the caller's own generated packet for one
 * posting. The engine child runs under the caller's store lease and reaches only the caller's
 * applications folder and per-posting row; a posting applied or later keeps its packet.
 * @param ctx - Kernel context used for brokered engine dispatch.
 * @param req - Express request.
 * @param res - Express response.
 * @returns Nothing.
 */
async function removePacket(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const postingId = Number(req.params.id);
    if (!Number.isSafeInteger(postingId) || postingId <= 0) {
        res.status(400).json({ error: 'bad id' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['packet-remove'], { CH_JOB: String(postingId) });
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'packet removal');
        return;
    }
    const json = result.ok ? (0, career_targets_1.parseEngineJson)(result.out) : null;
    if (!json) {
        logger.error({ userSub, postingId, err: (result.err || '').slice(-200) }, 'career packet removal failed');
        res.status(502).json({ error: 'the packet could not be removed' });
        return;
    }
    if (json.ok !== true) {
        res.status(PACKET_REFUSAL_STATUS[String(json.code)] || 400).json({ error: String(json.error || 'refused') });
        return;
    }
    logger.info({ userSub, postingId }, 'career packet removed');
    res.json(json);
}
/** Preview this user's generated queue rows whose packet timestamp is at least seven days old. */
async function previewGeneratedPurge(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const cutoffAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['packet-purge-preview'], {
        CH_PURGE_CUTOFF: cutoffAt,
    });
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'purge preview');
        return;
    }
    const json = (0, career_targets_1.parseEngineJson)(result.out);
    if (!result.ok || !json) {
        logger.error({ userSub, err: (result.err || '').slice(-200) }, 'career purge preview failed');
        res.status(502).json({ error: 'the Ready queue could not be previewed' });
        return;
    }
    if (json.ok !== true) {
        res.status(400).json({ error: String(json.error || 'preview refused'), code: json.code });
        return;
    }
    res.json(json);
}
/** Permanently purge exactly the previewed old generated rows after an explicit count phrase. */
async function purgeGenerated(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const cutoffAt = typeof req.body?.cutoffAt === 'string' ? req.body.cutoffAt : '';
    const expectedCount = Number(req.body?.expectedCount);
    const confirmation = typeof req.body?.confirmation === 'string' ? req.body.confirmation : '';
    const cutoffTime = Date.parse(cutoffAt);
    if (!Number.isFinite(cutoffTime) || cutoffTime > Date.now() - 7 * 24 * 60 * 60 * 1000) {
        res.status(400).json({ error: 'cutoff must be a valid timestamp at least seven days old' });
        return;
    }
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0
        || confirmation !== `PURGE ${expectedCount}`) {
        res.status(400).json({ error: 'the exact preview count must be confirmed' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['packet-purge'], {
        CH_PURGE_CUTOFF: cutoffAt,
        CH_PURGE_EXPECTED_COUNT: String(expectedCount),
    });
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'packet purge');
        return;
    }
    const json = (0, career_targets_1.parseEngineJson)(result.out);
    if (!json) {
        logger.error({ userSub, err: (result.err || '').slice(-200) }, 'career packet purge failed');
        res.status(502).json({ error: 'the Ready queue could not be purged' });
        return;
    }
    if (json.ok !== true) {
        const status = json.code === 'count-changed' ? 409 : 400;
        res.status(status).json({ error: String(json.error || 'purge refused'), code: json.code,
            ...(Number.isSafeInteger(json.readyRows) ? { readyRows: json.readyRows } : {}) });
        return;
    }
    logger.info({ userSub, purgedRows: json.purgedReadyRows,
        packetDirectories: json.removedPacketDirectories }, 'career old generated queue purged');
    res.json(json);
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
/** Read the existing original-owner email update projection without starting a check. */
function getJobUpdates(req, res) {
    const sub = (0, career_user_store_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    try {
        res.json(emailUpdates.publicState(emailUpdates.read((0, career_user_store_1.userPaths)(sub).userDir)));
    }
    catch (_) {
        res.status(500).json({ error: 'Application email state unavailable' });
    }
}
/** Preserve the explicit email check and reconciliation under the existing admitted owner's store. */
async function checkJobUpdates(ctx, req, res) {
    const sub = (0, career_user_store_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const db = (0, career_user_store_1.openUserDb)(sub, false);
    if (!db) {
        res.status(404).json({ error: 'Upload a resume before monitoring application email.' });
        return;
    }
    try {
        const submissionReconciliation = await require('../lib/career-submission-routes').reconcileCareerSubmissions(ctx, sub);
        res.json({ ...await emailUpdates.check((0, career_user_store_1.userPaths)(sub).userDir, db), submissionReconciliation });
    }
    catch (_) {
        res.status(500).json({ error: 'Application email check failed' });
    }
    finally {
        db.close();
    }
}
/**
 * @description Registers native job-board reads and caller-owned board mutations.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used for asynchronous packet generation.
 * @returns Nothing.
 */
function registerCareerBoardRoutes(router, ctx) {
    (0, career_progress_1.registerCareerProgressRoutes)(router);
    workflowRoutes.register(router, ctx, career_engine_dispatch_1.runCareerCliAsync);
    router.get('/experience-library', (0, career_surface_routes_1.createCareerToolFileHandler)('career-experience-bank.html'));
    router.get('/experience-bank', (req, res) => { const sub = (0, career_user_store_1.callerSub)(req); if (!sub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    } try {
        const bank = experienceBank.read((0, career_user_store_1.userPaths)(sub).userDir);
        res.json(req.query.summary === '1' ? { ...bank, entries: bank.entries.map(({ facts, ...entry }) => entry) } : bank);
    }
    catch (error) {
        res.status(error.status || 503).json({ error: error.message });
    } });
    router.post('/experience-bank', (req, res) => { const sub = (0, career_user_store_1.callerSub)(req); if (!sub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    } try {
        res.json({ ok: true, ...experienceBank.update((0, career_user_store_1.userPaths)(sub).userDir, req.body) });
    }
    catch (error) {
        res.status(error.status || 503).json({ error: error.message });
    } });
    router.get('/jobs', (req, res) => { void getJobs(ctx, req, res); });
    router.get('/jobs/stats', (req, res) => { void getJobStats(ctx, req, res); });
    router.get('/jobs/purge-generated', (req, res) => { void previewGeneratedPurge(ctx, req, res); });
    router.delete('/jobs/purge-generated', (req, res) => { void purgeGenerated(ctx, req, res); });
    router.get('/analytics', getAnalytics);
    router.get('/resume', (req, res) => serveResumeFile(req, res, Number(req.query.id)));
    router.post('/jobs/:id/status', (req, res) => updateJobStatus(ctx, req, res));
    router.get('/jobs/updates', getJobUpdates);
    router.post('/jobs/updates/check', (req, res) => checkJobUpdates(ctx, req, res));
    router.get('/jobs/:id', getJob);
    router.post('/jobs/:id/generate', (req, res) => generatePacket(ctx, req, res));
    router.delete('/jobs/:id/packet', (req, res) => { void removePacket(ctx, req, res); });
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