"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted administrator-only shared-company inspection and career-board refresh routes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCareerAdmin = isCareerAdmin;
exports.registerCareerCompanyRoutes = registerCareerCompanyRoutes;
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_surface_routes_1 = require("./career-surface-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'career-company-routes' });
const CAREER_ADMIN_SUBS = new Set((process.env.CAREER_HUNTER_ADMIN_SUBS || '')
    .split(',')
    .map((sub) => sub.trim())
    .filter(Boolean));
/**
 * @description Checks the fail-closed Career Hunter administrator allow-list.
 * @param sub - Authenticated OIDC subject or trusted service subject.
 * @returns True only when the subject is explicitly configured as an administrator.
 */
function isCareerAdmin(sub) {
    return !!sub && CAREER_ADMIN_SUBS.has(sub);
}
const requireCareerAdmin = (req, res, next) => {
    if (!isCareerAdmin((0, career_user_store_1.callerSub)(req))) {
        res.status(403).json({ error: 'admin only' });
        return;
    }
    next();
};
function listCompanies(req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    const db = userSub && (0, career_user_store_1.openUserDb)(userSub);
    if (!db) {
        res.json({ companies: [] });
        return;
    }
    try {
        const companies = db.prepare(`SELECT c.id, c.name, c.ats_type, c.ats_token, c.careers_url, c.discover_status,
              (SELECT COUNT(*) FROM corpus.postings_corpus p WHERE p.company_id=c.id AND p.active=1) AS active_jobs
         FROM corpus.companies c
        ORDER BY active_jobs DESC, c.name`).all();
        res.json({ companies });
    }
    catch (err) {
        logger.error({ err, userSub }, 'company list failed');
        res.status(500).json({ error: 'read failed' });
    }
    finally {
        db.close();
    }
}
async function setCompanyUrl(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const companyId = parseInt(String(req.query.companyId ?? ''), 10);
    const url = String(req.query.url ?? '').trim();
    if (!companyId || !url) {
        res.status(400).json({ error: 'companyId and url required' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['seturl', '--company-id', String(companyId), '--url', url]);
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'company refresh');
        return;
    }
    let parsed = null;
    try {
        parsed = JSON.parse((result.out || '').trim().split('\n').pop() || '{}');
    }
    catch (err) {
        logger.warn({ err, companyId }, 'company refresh returned non-JSON output');
    }
    res.json({
        ok: result.ok,
        result: parsed,
        error: result.ok ? undefined : (result.err || '').slice(-300),
    });
}
/**
 * @description Registers the administrator-only shared-company routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used to run the brokered company refresh command.
 * @returns Nothing.
 */
function registerCareerCompanyRoutes(router, ctx) {
    router.get('/companies-admin', requireCareerAdmin, (0, career_surface_routes_1.createCareerToolFileHandler)('career-companies.html'));
    router.get('/companies-admin/list', requireCareerAdmin, listCompanies);
    router.post('/companies-admin/seturl', requireCareerAdmin, (req, res) => {
        void setCompanyUrl(ctx, req, res);
    });
}
//# sourceMappingURL=career-company-routes.js.map