"use strict";
/**
 * Venture Plan — owner-scoped Saved-quote inbox HTTP routes.
 *
 * Mounted on the interactive `/api/venture` router. Zero model calls: attaching a
 * quote document runs pure deterministic extraction (`venture-quote-parser.ts`)
 * and saves a `pending` inbox item; promotion writes a real quote through
 * `applyQuote` and synchronously recomputes the model for free.
 *
 * Every handler enforces `requireSub(req, res)` before touching the pool, uses
 * `req.headers['content-type']` (never Express-only `req.is`), and binds strictly
 * to existing `[venture.read]` / `[venture.change]` permissions in
 * `authorization.yaml`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial owner-scoped quote inbox HTTP routes: GET list, POST attach & parse, POST promote with FX enforcement and free recompute, and POST dismiss.
 *
 * @module venture-routes-quote-inbox
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerQuoteInboxRoutes = registerQuoteInboxRoutes;
const venture_http_1 = require("./venture-http");
const venture_store_1 = require("./venture-store");
const venture_run_1 = require("./venture-run");
const venture_currency_1 = require("./venture-currency");
const venture_quote_parser_1 = require("./venture-quote-parser");
const venture_store_quote_inbox_1 = require("./venture-store-quote-inbox");
function onDateOf(req) {
    const raw = String(req.query.onDate ?? req.body?.onDate ?? '');
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}
function replyInboxError(res, err) {
    if (err instanceof venture_quote_parser_1.QuoteInboxError) {
        const status = err.code === 'quote_inbox_not_found' ? 404
            : (err.code === 'quote_inbox_already_promoted' || err.code === 'quote_inbox_dismissed') ? 409
                : 400;
        res.status(status).json({ error: err.code, detail: err.message });
        return true;
    }
    if (err instanceof venture_currency_1.VentureFxError) {
        const notFound = new Set([
            'fx_assumption_not_found', 'fx_venture_not_found',
            'quote_vendor_not_found', 'quote_bom_line_not_found',
        ]);
        const status = err.code === 'fx_idempotency_conflict' ? 409
            : notFound.has(err.code) ? 404 : 400;
        res.status(status).json({ error: err.code, detail: err.message });
        return true;
    }
    return false;
}
function summariseModel(r) {
    return {
        modelId: r.snapshot.id,
        computedAt: r.snapshot.computedAt,
        engineVersion: r.snapshot.engineVersion,
        inputsHash: r.snapshot.inputsHash,
        posture: r.snapshot.posture,
        canPublish: r.snapshot.canPublish,
        coverage: r.snapshot.coverage,
        figures: r.snapshot.figures,
        tables: r.snapshot.tables,
        warnings: r.snapshot.warnings,
        missingAssumptionKeys: r.missingAssumptionKeys,
    };
}
/** Register the four Saved-quote inbox routes on `/api/venture`. */
function registerQuoteInboxRoutes(router, pool) {
    router.get('/ventures/:id/quote-inbox', (0, venture_http_1.guarded)('GET /ventures/:id/quote-inbox', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.json({ items: await (0, venture_store_quote_inbox_1.listQuoteInbox)(pool, sub, id) });
    }));
    router.post('/ventures/:id/quote-inbox', (0, venture_http_1.guarded)('POST /ventures/:id/quote-inbox', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase();
        const body = (req.body ?? {});
        try {
            const parsed = (0, venture_quote_parser_1.parseQuoteDocument)({
                filename: String(body.filename ?? ''),
                mimeType: typeof body.mimeType === 'string' && body.mimeType.trim()
                    ? body.mimeType
                    : (contentType.includes('text/plain') ? 'text/plain' : 'text/plain'),
                textContent: typeof body.textContent === 'string' ? body.textContent : null,
                base64Bytes: typeof body.base64Bytes === 'string' ? body.base64Bytes : null,
            });
            const item = await (0, venture_store_quote_inbox_1.insertQuoteInboxItem)(pool, sub, id, parsed);
            if (!item) {
                res.status(404).json({ error: 'not found' });
                return;
            }
            res.status(201).json({ item });
        }
        catch (err) {
            if (!replyInboxError(res, err))
                throw err;
        }
    }));
    router.post('/ventures/:id/quote-inbox/:itemId/promote', (0, venture_http_1.guarded)('POST /ventures/:id/quote-inbox/:itemId/promote', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        const itemId = String(req.params.itemId);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        const body = (req.body ?? {});
        try {
            const promoted = await (0, venture_store_quote_inbox_1.promoteQuoteInboxItem)(pool, sub, id, itemId, body);
            const recomputed = await (0, venture_run_1.recomputeVenture)(pool, sub, id, { onDate: onDateOf(req) });
            res.status(201).json({
                ...promoted,
                model: recomputed ? summariseModel(recomputed) : null,
            });
        }
        catch (err) {
            if (!replyInboxError(res, err))
                throw err;
        }
    }));
    router.post('/ventures/:id/quote-inbox/:itemId/dismiss', (0, venture_http_1.guarded)('POST /ventures/:id/quote-inbox/:itemId/dismiss', async (req, res) => {
        const sub = (0, venture_http_1.requireSub)(req, res);
        if (!sub)
            return;
        const id = String(req.params.id);
        const itemId = String(req.params.itemId);
        if (!await (0, venture_store_1.getVenture)(pool, sub, id)) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        try {
            const item = await (0, venture_store_quote_inbox_1.dismissQuoteInboxItem)(pool, sub, id, itemId);
            res.json({ item });
        }
        catch (err) {
            if (!replyInboxError(res, err))
                throw err;
        }
    }));
}
