"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted resume-strengthening reads and bounded engine mutations from the route composition root.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerStrengthenRoutes = registerCareerStrengthenRoutes;
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const logger = (0, logger_1.createChildLogger)({ module: 'career-strengthen-routes' });
async function listStrengthen(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['strengthen', 'list']);
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'strengthen list');
        return;
    }
    if (!result.ok) {
        logger.error({ err: result.err, userSub }, 'strengthen list failed');
        res.status(500).json({ error: 'list failed' });
        return;
    }
    try {
        const start = result.out.indexOf('{');
        res.json(start >= 0 ? JSON.parse(result.out.slice(start)) : { themes: [], total: 0 });
    }
    catch (err) {
        logger.error({ err, userSub, tail: result.out.slice(-300) }, 'strengthen parse failed');
        res.status(500).json({ error: 'parse failed' });
    }
}
async function scanStrengthen(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const started = await (0, career_engine_dispatch_1.runCareerCliAsync)(ctx.pool, userSub, ['strengthen', 'scan']);
    if ((0, career_engine_response_1.rejectEngineStart)(res, started, 'strengthen scan'))
        return;
    res.status(202).json({ ok: true, status: 'scanning' });
}
async function answerStrengthen(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const key = String(req.body?.key || '').trim();
    const response = String(req.body?.response || '').trim();
    if (!key || !response) {
        res.status(400).json({ error: 'key + response required' });
        return;
    }
    const started = await (0, career_engine_dispatch_1.runCareerCliAsync)(ctx.pool, userSub, ['strengthen', 'answer'], {
        CH_KEY: key,
        CH_RESP: response,
    });
    if ((0, career_engine_response_1.rejectEngineStart)(res, started, 'strengthen answer'))
        return;
    res.status(202).json({ ok: true, status: 'augmenting' });
}
async function setStrengthenStatus(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const key = String(req.params.key || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!key || !['open', 'skipped', 'answered'].includes(status)) {
        res.status(400).json({ error: 'bad request' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['strengthen', 'status'], {
        CH_KEY: key,
        CH_STATUS: status,
    });
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'strengthen status');
        return;
    }
    res.json({ ok: result.ok });
}
/**
 * @description Registers resume-strengthening list, scan, answer, and status routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to run caller-brokered engine commands.
 * @returns Nothing.
 */
function registerCareerStrengthenRoutes(router, ctx) {
    router.get('/strengthen', (req, res) => listStrengthen(ctx, req, res));
    router.post('/strengthen/scan', (req, res) => scanStrengthen(ctx, req, res));
    router.post('/strengthen/answer', (req, res) => answerStrengthen(ctx, req, res));
    router.post('/strengthen/:key/status', (req, res) => setStrengthenStatus(ctx, req, res));
}
//# sourceMappingURL=career-strengthen-routes.js.map