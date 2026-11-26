/**
 * Venture Plan — owner-scoped Saved-quote inbox store.
 *
 * Attached supplier quote documents land here as `pending` items with their exact
 * SHA-256 digest, bounded excerpt, and deterministically parsed candidate fields.
 * Nothing enters `venture_quotes`, `venture_assumptions`, or `venture_bom_lines`
 * until the operator explicitly reviews and promotes the inbox item.
 *
 * Promotion enforces the exact existing foreign-currency FX snapshot contract
 * (`applyQuote` / `VentureFxError('fx_assumption_required')`) before mutating the
 * inbox status, stamps the quote with document filename + SHA-256 provenance, and
 * refuses double-promotion (`409`) and cross-owner access (`404`).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial owner-scoped quote inbox persistence: list, get, insert, dismiss, and operator-reviewed promote into venture_quotes with FX enforcement and document provenance.
 *
 * @module venture-store-quote-inbox
 */

import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { getVenture } from './venture-store';
import { getFxAssumption } from './venture-store-fx';
import {
  applyQuote, insertVendor, listVendors, type QuoteInput,
} from './venture-store-supply';
import {
  assertCurrencyMicros, normalizeCurrencyCode, VentureFxError,
} from './venture-currency';
import {
  QuoteInboxError, SUPPORTED_INCOTERMS,
  type ExtractedQuoteFields, type ParsedQuoteDocument,
} from './venture-quote-parser';
import type {
  Assumption, Quote, QuoteInboxItem, QuoteInboxStatus,
} from './venture-types';

const log = createChildLogger({ module: 'venture-store-quote-inbox' });
const LIST_LIMIT = 500;

/** Operator-reviewed fields supplied when promoting an inbox item into a real quote. */
export interface PromoteQuoteInboxInput {
  vendorId?: string | null;
  vendorName?: string | null;
  bomLineId?: string | null;
  assumptionKey?: string | null;
  unitPriceMicros?: number;
  unitCostMicros?: number;
  toolingCostMicros?: number;
  currency?: string | null;
  fxAssumptionId?: string | null;
  moq?: number | null;
  qtyBreak?: number | null;
  leadTimeDays?: number | null;
  incoterm?: string | null;
  quoteRef?: string | null;
  notes?: string | null;
}

function toExtracted(raw: unknown): ExtractedQuoteFields {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    vendorName: str(obj.vendorName),
    itemLabel: str(obj.itemLabel),
    unitPriceMicros: num(obj.unitPriceMicros),
    currency: str(obj.currency),
    moq: num(obj.moq),
    leadTimeDays: num(obj.leadTimeDays),
    incoterm: str(obj.incoterm),
    quoteRef: str(obj.quoteRef),
    extractionNotes: Array.isArray(obj.extractionNotes) ? obj.extractionNotes.map(String) : [],
  };
}

function toInboxItem(r: Record<string, any>): QuoteInboxItem {
  const parsedJson = typeof r.extracted_json === 'string'
    ? JSON.parse(r.extracted_json) : r.extracted_json;
  return {
    id: String(r.id),
    ventureId: String(r.venture_id),
    filename: String(r.filename),
    mimeType: String(r.mime_type),
    byteSize: Number(r.byte_size),
    sha256: String(r.sha256),
    rawExcerpt: String(r.raw_excerpt ?? ''),
    extracted: toExtracted(parsedJson),
    status: String(r.status) as QuoteInboxStatus,
    promotedQuoteId: r.promoted_quote_id ? String(r.promoted_quote_id) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** List owner's quote inbox items for a venture, newest first. */
export async function listQuoteInbox(
  pool: Pool, ownerSub: string, ventureId: string,
): Promise<QuoteInboxItem[]> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_quote_inbox
      WHERE venture_id = $1 AND owner_sub = $2
      ORDER BY created_at DESC LIMIT $3`,
    [ventureId, ownerSub, LIST_LIMIT],
  );
  return rows.map(toInboxItem);
}

/** Read one owner-scoped quote inbox item, or null for missing/foreign items. */
export async function getQuoteInboxItem(
  pool: Pool, ownerSub: string, ventureId: string, itemId: string,
): Promise<QuoteInboxItem | null> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_quote_inbox
      WHERE id = $1 AND venture_id = $2 AND owner_sub = $3`,
    [itemId, ventureId, ownerSub],
  );
  return rows.length ? toInboxItem(rows[0]) : null;
}

/** Insert a parsed quote document into the owner's inbox as `pending`. */
export async function insertQuoteInboxItem(
  pool: Pool, ownerSub: string, ventureId: string, parsed: ParsedQuoteDocument,
): Promise<QuoteInboxItem | null> {
  const { rows } = await pool.query(
    `INSERT INTO venture_quote_inbox
       (venture_id, owner_sub, filename, mime_type, byte_size, sha256, raw_excerpt, extracted_json, status)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending'
       FROM venture_ventures
      WHERE id = $1 AND owner_sub = $2
     RETURNING *`,
    [
      ventureId, ownerSub, parsed.filename, parsed.mimeType, parsed.byteSize,
      parsed.sha256, parsed.rawExcerpt, JSON.stringify(parsed.extracted),
    ],
  );
  if (!rows.length) return null;
  const item = toInboxItem(rows[0]);
  log.info({ ownerSub, ventureId, inboxItemId: item.id, sha256: item.sha256 }, 'quote inbox item attached');
  return item;
}

/** Dismiss a pending quote inbox item, refusing already-promoted items. */
export async function dismissQuoteInboxItem(
  pool: Pool, ownerSub: string, ventureId: string, itemId: string,
): Promise<QuoteInboxItem> {
  const existing = await getQuoteInboxItem(pool, ownerSub, ventureId, itemId);
  if (!existing) {
    throw new QuoteInboxError('quote_inbox_not_found', 'quote inbox item is missing or not owned by the caller');
  }
  if (existing.status === 'promoted') {
    throw new QuoteInboxError('quote_inbox_already_promoted', 'promoted quote inbox items cannot be dismissed');
  }
  if (existing.status === 'dismissed') return existing;
  const { rows } = await pool.query(
    `UPDATE venture_quote_inbox
        SET status = 'dismissed', updated_at = NOW()
      WHERE id = $1 AND venture_id = $2 AND owner_sub = $3 AND status = 'pending'
     RETURNING *`,
    [itemId, ventureId, ownerSub],
  );
  if (!rows.length) {
    throw new QuoteInboxError('quote_inbox_already_promoted', 'quote inbox item is no longer pending');
  }
  return toInboxItem(rows[0]);
}

function resolveUnitPriceMicros(input: PromoteQuoteInboxInput, extracted: ExtractedQuoteFields): number {
  const raw = input.unitPriceMicros !== undefined
    ? input.unitPriceMicros
    : (input.unitCostMicros !== undefined ? input.unitCostMicros : extracted.unitPriceMicros);
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new QuoteInboxError('quote_inbox_invalid_promotion', 'non-negative integer unitPriceMicros is required');
  }
  return assertCurrencyMicros(raw, 'unitPriceMicros');
}

function resolvePositiveIntField(val: unknown, fallback: number | null, field: string): number | null {
  if (val === undefined) return fallback;
  if (val === null || val === '') return null;
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 1 || val > 100_000_000) {
    throw new QuoteInboxError('quote_inbox_invalid_promotion', `${field} must be a positive integer`);
  }
  return val;
}

function resolveIncotermField(val: unknown, fallback: string | null): string | null {
  const raw = val === undefined ? fallback : (typeof val === 'string' ? val.trim() : null);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (!SUPPORTED_INCOTERMS.includes(upper)) {
    throw new QuoteInboxError('quote_inbox_invalid_promotion', `incoterm must be one of ${SUPPORTED_INCOTERMS.join(', ')}`);
  }
  return upper;
}

/** Validate FX requirements BEFORE creating any vendor so unbound foreign promotes write nothing. */
async function preflightFxBinding(
  pool: Pool, ownerSub: string, ventureId: string,
  currency: string, reportingCurrency: string, fxAssumptionId: string | null,
): Promise<void> {
  if (currency === reportingCurrency) {
    if (fxAssumptionId) {
      throw new VentureFxError('redundant_fx_assumption', 'same-currency quotes must not bind an FX assumption');
    }
    return;
  }
  if (!fxAssumptionId) {
    throw new VentureFxError('fx_assumption_required', 'foreign quotes require an immutable fxAssumptionId');
  }
  const fx = await getFxAssumption(pool, ownerSub, ventureId, fxAssumptionId);
  if (!fx) throw new VentureFxError('fx_assumption_not_found', 'FX assumption is missing or not owned by the caller');
  if (fx.sourceCurrency !== currency || fx.reportingCurrency !== reportingCurrency) {
    throw new VentureFxError('fx_assumption_mismatch', 'FX assumption currencies do not match the quote and venture');
  }
}

async function resolveOrCreateVendorId(
  pool: Pool, ownerSub: string, ventureId: string,
  input: PromoteQuoteInboxInput, item: QuoteInboxItem, moq: number | null, leadTimeDays: number | null,
): Promise<string> {
  if (typeof input.vendorId === 'string' && input.vendorId.trim()) return input.vendorId.trim();
  const candidateName = String(input.vendorName ?? item.extracted.vendorName ?? '').trim();
  if (!candidateName) {
    throw new QuoteInboxError('quote_vendor_required', 'vendorId or vendorName is required to promote a quote');
  }
  const existing = (await listVendors(pool, ownerSub, ventureId))
    .find((v) => v.name.trim().toLowerCase() === candidateName.toLowerCase());
  if (existing) return existing.id;
  const created = await insertVendor(pool, ownerSub, ventureId, {
    name: candidateName.slice(0, 160),
    kind: 'component',
    moq,
    leadTimeDays,
    sourceKind: 'vendor-quote',
    confidence: 'high',
    notes: `Created from saved quote ${item.filename} (sha256:${item.sha256.slice(0, 12)})`,
  });
  return created.id;
}

function buildProvenanceNotes(operatorNotes: string | null | undefined, item: QuoteInboxItem): string {
  const provenance = `Source document: ${item.filename} (sha256:${item.sha256})`;
  const trimmed = typeof operatorNotes === 'string' ? operatorNotes.trim() : '';
  return trimmed ? `${trimmed} | ${provenance}` : provenance;
}

/**
 * @description Promote a pending inbox item into a real owner-scoped `venture_quotes` row.
 *   Enforces foreign FX binding before any write, records document filename + SHA-256
 *   provenance on the quote, and transitions the inbox item atomically to `promoted`.
 */
export async function promoteQuoteInboxItem(
  pool: Pool, ownerSub: string, ventureId: string, itemId: string,
  input: PromoteQuoteInboxInput,
): Promise<{ item: QuoteInboxItem; quote: Quote; assumption: Assumption | null; supersededId: string | null }> {
  const venture = await getVenture(pool, ownerSub, ventureId);
  if (!venture) {
    throw new QuoteInboxError('quote_inbox_not_found', 'venture is missing or not owned by the caller');
  }
  const existing = await getQuoteInboxItem(pool, ownerSub, ventureId, itemId);
  if (!existing) {
    throw new QuoteInboxError('quote_inbox_not_found', 'quote inbox item is missing or not owned by the caller');
  }
  if (existing.status === 'promoted') {
    throw new QuoteInboxError('quote_inbox_already_promoted', 'quote inbox item has already been promoted');
  }
  if (existing.status === 'dismissed') {
    throw new QuoteInboxError('quote_inbox_dismissed', 'dismissed quote inbox item cannot be promoted');
  }

  const unitCostMicros = resolveUnitPriceMicros(input, existing.extracted);
  const toolingCostMicros = input.toolingCostMicros !== undefined
    ? assertCurrencyMicros(input.toolingCostMicros, 'toolingCostMicros') : 0;
  const reportingCurrency = normalizeCurrencyCode(venture.currency, 'venture currency');
  const currency = normalizeCurrencyCode(input.currency ?? existing.extracted.currency ?? reportingCurrency, 'currency');
  const fxAssumptionId = typeof input.fxAssumptionId === 'string' && input.fxAssumptionId.trim()
    ? input.fxAssumptionId.trim() : null;
  const qtyBreak = resolvePositiveIntField(input.moq ?? input.qtyBreak, existing.extracted.moq ?? 1, 'moq') ?? 1;
  const leadTimeDays = resolvePositiveIntField(input.leadTimeDays, existing.extracted.leadTimeDays, 'leadTimeDays');
  const incoterm = resolveIncotermField(input.incoterm, existing.extracted.incoterm);

  // Refuse unbound/mismatched foreign FX BEFORE creating any vendor or quote row.
  await preflightFxBinding(pool, ownerSub, ventureId, currency, reportingCurrency, fxAssumptionId);

  const vendorId = await resolveOrCreateVendorId(pool, ownerSub, ventureId, input, existing, qtyBreak, leadTimeDays);
  const quoteInput: QuoteInput = {
    vendorId,
    bomLineId: typeof input.bomLineId === 'string' && input.bomLineId.trim() ? input.bomLineId.trim() : null,
    assumptionKey: typeof input.assumptionKey === 'string' && input.assumptionKey.trim() ? input.assumptionKey.trim() : null,
    qtyBreak,
    unitCostMicros,
    toolingCostMicros,
    currency,
    fxAssumptionId,
    incoterm,
    leadTimeDays,
    documentRef: String(input.quoteRef ?? existing.extracted.quoteRef ?? existing.filename).slice(0, 240),
    notes: buildProvenanceNotes(input.notes, existing),
  };

  const applied = await applyQuote(pool, ownerSub, ventureId, quoteInput);
  const { rows } = await pool.query(
    `UPDATE venture_quote_inbox
        SET status = 'promoted', promoted_quote_id = $4, updated_at = NOW()
      WHERE id = $1 AND venture_id = $2 AND owner_sub = $3 AND status = 'pending'
     RETURNING *`,
    [itemId, ventureId, ownerSub, applied.quote.id],
  );
  if (!rows.length) {
    throw new QuoteInboxError('quote_inbox_already_promoted', 'quote inbox item was already promoted concurrently');
  }
  const item = toInboxItem(rows[0]);
  log.info({ ownerSub, ventureId, inboxItemId: item.id, quoteId: applied.quote.id }, 'quote inbox item promoted');
  return { item, ...applied };
}
