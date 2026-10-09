"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Serve the PostgreSQL cutover observation window to operators: GET /status reads the archive engine/sync/observe_cutover.py writes (window.json + latest.json) and returns the window, the latest sample's signals and its violations. Anonymous callers get 401 and signed-in non-operators 403 before any file is read; nothing is written, queried or cached.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cutoverArchiveDir = cutoverArchiveDir;
exports.publicSample = publicSample;
exports.createCareerCutoverStatusRoutes = createCareerCutoverStatusRoutes;
/**
 * Career storage-cutover observation status (BACKEND-CUTOVER.md, "Seven-day observation").
 * @module career-cutover-status
 */
const express_1 = require("express");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-cutover-status' });
/**
 * @description Where the observer archives its samples: CAREER_CUTOVER_ARCHIVE_DIR, or `_cutover`
 * beside the tenant's corpus.db (the observer's own default of `<data-root>/_cutover`). The leading
 * underscore keeps the loader, reporter, projector and cron from ever treating it as a user store.
 * @returns The absolute archive directory.
 */
function cutoverArchiveDir() {
    const configured = (process.env.CAREER_CUTOVER_ARCHIVE_DIR || '').trim();
    return configured ? path_1.default.resolve(configured) : path_1.default.join(path_1.default.dirname((0, career_user_store_1.corpusDbPath)()), '_cutover');
}
/** Read one archive JSON file; an absent file is "not observed yet", anything else is an error. */
async function readArchiveJson(file) {
    try {
        return JSON.parse(await fs_1.promises.readFile(file, 'utf8'));
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return null;
        throw err;
    }
}
/**
 * @description Reduce a stored sample to what an operator needs on a status page. The owner-isolation
 * probe's per-owner breakdown is dropped (its totals remain); convergence failures are already
 * labelled with hashed owner ids by the observer.
 * @param sample - One sample exactly as observe_cutover.py stored it.
 * @returns The served subset.
 */
function publicSample(sample) {
    const rls = (sample.rls ?? {});
    return {
        sampledAt: sample.sampledAt, inBounds: sample.inBounds, violations: sample.violations,
        nightly: sample.nightly, convergence: sample.convergence, reverseSync: sample.reverseSync,
        rls: { probedOwners: rls.probedOwners, foreignRowsVisible: rls.foreignRowsVisible, ok: rls.ok },
        activity: sample.activity, archivedReport: sample.archivedReport,
    };
}
/** Refuse anonymous and non-operator callers before touching the archive. */
function refuse(req, res) {
    const oidc = req.oidc;
    if (!oidc?.user?.sub || oidc.isAuthenticated?.() !== true) {
        res.status(401).json({ error: 'not_authenticated' });
        return true;
    }
    if (!(0, authz_1.isOperator)(req)) {
        res.status(403).json({ error: 'Operator access required' });
        return true;
    }
    return false;
}
/** GET /status — the observation window and the latest sample. */
async function handleStatus(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (refuse(req, res))
        return;
    const started = Date.now();
    logger.info({ route: 'GET /status' }, 'career cutover status requested');
    try {
        const archive = cutoverArchiveDir();
        const [window, latest] = await Promise.all([
            readArchiveJson(path_1.default.join(archive, 'window.json')),
            readArchiveJson(path_1.default.join(archive, 'latest.json')),
        ]);
        if (!window || !latest) {
            res.json({ schemaVersion: 1, state: 'not-started', window: null, latest: null });
        }
        else {
            res.json({ schemaVersion: 1, state: window.complete ? 'complete' : 'observing', window,
                latest: publicSample(latest) });
        }
        logger.info({ route: 'GET /status', durationMs: Date.now() - started }, 'career cutover status served');
    }
    catch (err) {
        logger.error({ err, route: 'GET /status' }, 'career cutover archive unreadable');
        res.status(500).json({ error: 'cutover_archive_unreadable' });
    }
}
/**
 * @description Factory for the operator-only cutover status route, mounted at
 * /api/career-hunter/cutover with `auth: oidc`.
 * @param _ctx - Kernel app context (unused: the route reads only the observer's archive).
 * @returns The Express router.
 */
function createCareerCutoverStatusRoutes(_ctx) {
    const router = (0, express_1.Router)();
    router.get('/status', (req, res) => { void handleStatus(req, res); });
    return router;
}
//# sourceMappingURL=career-cutover-status.js.map