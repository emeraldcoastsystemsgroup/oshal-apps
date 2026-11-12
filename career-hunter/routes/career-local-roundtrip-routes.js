"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | S-6 (1.52.0): GET /resume/local-export exports the caller's master resume as an OpenDocument Text (.odt) archive + structured text for local editing; POST /resume/local-import imports edited .odt/text back through the whitelisted base-save verb, preserving the previous version in backups/ and enrichment_log.jsonl.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, changes 4, 11, 12, 13 and 14: one name for each page and for each role. The answers a person reads say main résumé (was master resume). Words only; log lines, route paths and the item id `master` are unchanged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportLocalResume = exportLocalResume;
exports.importLocalResume = importLocalResume;
exports.registerCareerLocalRoundtripRoutes = registerCareerLocalRoundtripRoutes;
const logger_1 = require("@/shared/logger");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_user_store_1 = require("./career-user-store");
const roundtrip = require('../lib/career-local-roundtrip');
const logger = (0, logger_1.createChildLogger)({ module: 'career-local-roundtrip-routes' });
const MASTER_DOC_MAX_BYTES = 98000;
function parseEngineJson(out) {
    const start = out.indexOf('{');
    if (start < 0)
        return null;
    try {
        return JSON.parse(out.slice(start));
    }
    catch {
        return null;
    }
}
/**
 * @description GET /resume/local-export: exports the caller's master resume as a real .odt file (base64)
 * plus structured plain text for local round-trip editing.
 * @param ctx - Kernel application context.
 * @param req - Authenticated request.
 * @param res - Express response.
 * @returns Promise resolved after writing the response.
 */
async function exportLocalResume(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const result = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['resume', 'base']);
    if (result.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: result.limitReason }, 'main résumé local export');
        return;
    }
    const parsed = result.ok ? parseEngineJson(result.out) : null;
    if (!parsed) {
        logger.error({ err: result.err.slice(-300), userSub }, 'master resume local export failed');
        res.status(500).json({ ok: false, error: 'main résumé load failed' });
        return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(roundtrip.exportMasterResume(parsed));
}
/**
 * @description POST /resume/local-import: imports an edited local .odt or structured text back into
 * the caller's master resume through `resume base-save`, keeping the previous version in backups/.
 * @param ctx - Kernel application context.
 * @param req - Authenticated request.
 * @param res - Express response.
 * @returns Promise resolved after writing the response.
 */
async function importLocalResume(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
        ? req.body : {};
    const current = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['resume', 'base']);
    if (current.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: current.limitReason }, 'main résumé local import');
        return;
    }
    const masterDoc = current.ok ? parseEngineJson(current.out) : null;
    if (!masterDoc) {
        res.status(500).json({ ok: false, error: 'main résumé load failed' });
        return;
    }
    const prepared = roundtrip.prepareMasterImport(body, masterDoc);
    if (!prepared.ok || !prepared.resume) {
        res.status(422).json({ ok: false, error: prepared.error || 'invalid local resume import', notes: prepared.notes || [] });
        return;
    }
    const payload = JSON.stringify({ resume: prepared.resume });
    if (Buffer.byteLength(payload, 'utf8') > MASTER_DOC_MAX_BYTES) {
        res.status(413).json({ ok: false, error: 'main résumé payload too large' });
        return;
    }
    const saved = await (0, career_engine_dispatch_1.runCareerCliAwait)(ctx.pool, userSub, ['resume', 'base-save'], { CH_RESUME_DOC: payload });
    if (saved.limitReason) {
        (0, career_engine_response_1.rejectEngineStart)(res, { started: false, limitReason: saved.limitReason }, 'main résumé local import');
        return;
    }
    const out = parseEngineJson(saved.out);
    if (!out || out.ok !== true) {
        const refusal = String(out?.error || '').slice(0, 400);
        res.status(refusal ? 422 : 500).json({ ok: false, error: refusal || 'main résumé local import failed' });
        return;
    }
    const changelog = Array.isArray(out.changelog)
        ? out.changelog.slice(0, 50).map((line) => String(line).slice(0, 500)) : [];
    res.json({
        ok: true,
        itemId: 'master',
        changed: out.changed === true,
        changelog,
        notes: prepared.notes || [],
        previousText: prepared.previousText,
        importedText: prepared.importedText,
    });
}
/**
 * @description Registers the local editing export and import routes on the Career Hunter router.
 * @param router - The Career Hunter router mounted at /api/career-hunter.
 * @param ctx - Kernel application context.
 * @returns Nothing.
 */
function registerCareerLocalRoundtripRoutes(router, ctx) {
    router.get('/resume/local-export', (req, res) => exportLocalResume(ctx, req, res));
    router.post('/resume/local-import', (req, res) => importLocalResume(ctx, req, res));
}
