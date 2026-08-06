"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted manual engine runs, administrator refresh controls, and cron bootstrap from the route composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Return 202 for detached refresh work and map engine failure/timeouts to truthful 502/504 statuses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCareerCron = startCareerCron;
exports.registerCareerRunRoutes = registerCareerRunRoutes;
const logger_1 = require("@/shared/logger");
const authz_1 = require("@/shared/middleware/authz");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_company_routes_1 = require("./career-company-routes");
const career_user_store_1 = require("./career-user-store");
const logger = (0, logger_1.createChildLogger)({ module: 'career-run-routes' });
function refreshCallerSub(req) {
    return (0, career_user_store_1.callerSub)(req) ?? (0, authz_1.getTrustedServiceUserSub)(req);
}
function startRefresh(ctx, req, res) {
    const userSub = refreshCallerSub(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (!(0, career_company_routes_1.isCareerAdmin)(userSub)) {
        res.status(403).json({ error: 'admin only' });
        return;
    }
    const cron = require('./career-hunter-cron');
    if (cron.isEveningChainRunning()) {
        res.status(409).json({ ok: false, err: 'refresh already running' });
        return;
    }
    const users = (0, career_user_store_1.listStoreUsers)();
    if (!users.length) {
        res.status(500).json({ ok: false, err: 'no user stores' });
        return;
    }
    void cron.runEveningScrapeIndex(ctx, users, { manualRefresh: true });
    logger.info({ userSub, users: users.length }, 'career refresh chain started');
    res.status(202).json({
        ok: true,
        started: true,
        users: users.length,
        note: 'scrape+index runs detached; poll GET /run/refresh',
    });
}
function corpusFreshAt(userSub) {
    const fallbackSub = (0, career_user_store_1.listStoreUsers)()[0];
    const db = (0, career_user_store_1.openUserDb)(userSub) || (fallbackSub ? (0, career_user_store_1.openUserDb)(fallbackSub) : null);
    if (!db)
        return null;
    try {
        const row = db.prepare('SELECT MAX(last_seen_at) AS m FROM corpus.postings_corpus')
            .get();
        return row?.m ?? null;
    }
    catch (err) {
        logger.error({ err, userSub }, 'career corpus freshness read failed');
        return null;
    }
    finally {
        db.close();
    }
}
function getRefresh(req, res) {
    const userSub = refreshCallerSub(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const cron = require('./career-hunter-cron');
    res.json({
        running: cron.isEveningChainRunning(),
        corpusFreshAt: corpusFreshAt(userSub),
    });
}
function manualArgs(verb) {
    if (verb === 'score')
        return ['score', '--min-keyword', '40'];
    if (verb === 'match')
        return ['match'];
    return ['pull'];
}
async function runManualVerb(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const verb = req.params.verb;
    if (!['pull', 'score', 'match'].includes(verb)) {
        res.status(400).json({ error: 'verb' });
        return;
    }
    try {
        const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, manualArgs(verb), {}, { slot: verb });
        if (result.limitReason) {
            (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, verb);
            return;
        }
        if (!result.ok) {
            const status = result.timedOut ? 504 : 502;
            logger.warn({ userSub, verb, timedOut: result.timedOut }, 'career manual run rejected');
            res.status(status).json({ ok: false, out: result.out.slice(-1500), err: result.err.slice(-400) });
            return;
        }
        res.json({ ok: true, out: result.out.slice(-1500) });
    }
    catch (err) {
        logger.error({ err, userSub, verb }, 'career manual run failed');
        res.status(500).json({ ok: false, err: 'run failed' });
    }
}
/**
 * @description Starts the gated Career Hunter daily cron without introducing a module-eval cycle.
 * @param ctx - Kernel context consumed by the scheduled refresh pipeline.
 * @returns Nothing; disabled or failed startup is logged and leaves request routes available.
 */
function startCareerCron(ctx) {
    try {
        const cron = require('./career-hunter-cron');
        cron.startCareerHunterCron(ctx);
    }
    catch (err) {
        logger.warn({ err }, 'career-hunter cron not started');
    }
}
/**
 * @description Registers manual engine-run and administrator shared-refresh routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used by brokered commands and the refresh pipeline.
 * @returns Nothing.
 */
function registerCareerRunRoutes(router, ctx) {
    router.post('/run/refresh', (req, res) => startRefresh(ctx, req, res));
    router.get('/run/refresh', getRefresh);
    router.post('/run/:verb', (req, res) => runManualVerb(ctx, req, res));
}
//# sourceMappingURL=career-run-routes.js.map