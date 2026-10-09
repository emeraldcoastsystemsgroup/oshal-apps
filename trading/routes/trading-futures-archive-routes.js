"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFuturesArchiveRoutes = createFuturesArchiveRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose owned previews and explicitly confirmed shared-reference imports without accepting caller-supplied bars or authority.
 */
const express_1 = require("express");
const authz_1 = require("@/shared/middleware/authz");
const logger_1 = require("@/shared/logger");
const trading_futures_archive_import_1 = require("@/app/trading-futures-archive-import");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-futures-archive-routes' });
function failure(res, error) {
    logger.error({ err: error }, 'Futures archive request refused');
    const item = error;
    const status = item.code === '23505' ? 409 : item.statusCode ?? (['ZodError', 'TypeError', 'RangeError'].includes(item.name ?? '') ? 400 : 503);
    res.status(status).json({ error: item.code === '23505' ? 'another_archive_worker_is_active' :
            item.statusCode ? item.message : status === 400 ? 'invalid_archive_settings' : 'futures_archive_unavailable' });
}
/** @description Require the authenticated operator on every archive route; preserve exact caller ownership through the service.
 * @param ctx - Application services. @returns Routes mounted under the existing authenticated Trading package.
 */
function createFuturesArchiveRoutes(ctx) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = req.oidc?.user?.sub;
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        if (!(0, authz_1.isOperatorIdentity)(sub)) {
            res.status(403).json({ error: 'operator_only' });
            return;
        }
        if (!ctx?.pool) {
            res.status(503).json({ error: 'futures_archive_unavailable' });
            return;
        }
        next();
    });
    router.get('/', async (req, res) => {
        try {
            res.json({ imports: await (0, trading_futures_archive_import_1.listFuturesArchiveImports)(ctx.pool, req.oidc.user.sub) });
        }
        catch (error) {
            failure(res, error);
        }
    });
    router.post('/preview', async (req, res) => {
        try {
            res.status(202).json({ job: await (0, trading_futures_archive_import_1.previewFuturesArchive)(ctx.pool, req.oidc.user.sub, req.body) });
        }
        catch (error) {
            failure(res, error);
        }
    });
    router.post('/:importId/import', async (req, res) => {
        try {
            res.status(202).json({ job: await (0, trading_futures_archive_import_1.confirmFuturesArchive)(ctx.pool, req.oidc.user.sub, String(req.params.importId), req.body) });
        }
        catch (error) {
            failure(res, error);
        }
    });
    return router;
}
//# sourceMappingURL=trading-futures-archive-routes.js.map