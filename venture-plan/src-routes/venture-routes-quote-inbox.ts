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

import type { Request, Response, Router } from 'express';
import type { Pool } from 'pg';
import { guarded, requireSub } from './venture-http';
import { getVenture } from './venture-store';
import { recomputeVenture } from './venture-run';
import { VentureFxError } from './venture-currency';
import { parseQuoteDocument, QuoteInboxError } from './venture-quote-parser';
import {
  dismissQuoteInboxItem, insertQuoteInboxItem, listQuoteInbox,
  promoteQuoteInboxItem, type PromoteQuoteInboxInput,
} from './venture-store-quote-inbox';

function onDateOf(req: Request): string {
  const raw = String(req.query.onDate ?? (req.body as { onDate?: unknown })?.onDate ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

function replyInboxError(res: Response, err: unknown): boolean {
  if (err instanceof QuoteInboxError) {
    const status = err.code === 'quote_inbox_not_found' ? 404
      : (err.code === 'quote_inbox_already_promoted' || err.code === 'quote_inbox_dismissed') ? 409
        : 400;
    res.status(status).json({ error: err.code, detail: err.message });
    return true;
  }
  if (err instanceof VentureFxError) {
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

function summariseModel(r: NonNullable<Awaited<ReturnType<typeof recomputeVenture>>>) {
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
export function registerQuoteInboxRoutes(router: Router, pool: Pool): void {
  router.get('/ventures/:id/quote-inbox', guarded('GET /ventures/:id/quote-inbox', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const id = String(req.params.id);
    if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ items: await listQuoteInbox(pool, sub, id) });
  }));

  router.post('/ventures/:id/quote-inbox', guarded('POST /ventures/:id/quote-inbox', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const id = String(req.params.id);
    if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
    const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase();
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const parsed = parseQuoteDocument({
        filename: String(body.filename ?? ''),
        mimeType: typeof body.mimeType === 'string' && body.mimeType.trim()
          ? body.mimeType
          : (contentType.includes('text/plain') ? 'text/plain' : 'text/plain'),
        textContent: typeof body.textContent === 'string' ? body.textContent : null,
        base64Bytes: typeof body.base64Bytes === 'string' ? body.base64Bytes : null,
      });
      const item = await insertQuoteInboxItem(pool, sub, id, parsed);
      if (!item) { res.status(404).json({ error: 'not found' }); return; }
      res.status(201).json({ item });
    } catch (err) {
      if (!replyInboxError(res, err)) throw err;
    }
  }));

  router.post('/ventures/:id/quote-inbox/:itemId/promote', guarded('POST /ventures/:id/quote-inbox/:itemId/promote', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const id = String(req.params.id);
    const itemId = String(req.params.itemId);
    if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
    const body = (req.body ?? {}) as PromoteQuoteInboxInput;
    try {
      const promoted = await promoteQuoteInboxItem(pool, sub, id, itemId, body);
      const recomputed = await recomputeVenture(pool, sub, id, { onDate: onDateOf(req) });
      res.status(201).json({
        ...promoted,
        model: recomputed ? summariseModel(recomputed) : null,
      });
    } catch (err) {
      if (!replyInboxError(res, err)) throw err;
    }
  }));

  router.post('/ventures/:id/quote-inbox/:itemId/dismiss', guarded('POST /ventures/:id/quote-inbox/:itemId/dismiss', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const id = String(req.params.id);
    const itemId = String(req.params.itemId);
    if (!await getVenture(pool, sub, id)) { res.status(404).json({ error: 'not found' }); return; }
    try {
      const item = await dismissQuoteInboxItem(pool, sub, id, itemId);
      res.json({ item });
    } catch (err) {
      if (!replyInboxError(res, err)) throw err;
    }
  }));
}
