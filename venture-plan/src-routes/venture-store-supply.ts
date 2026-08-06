/**
 * Venture Plan — the supply-chain store: BOM, vendors, quotes, schedule, headcount.
 *
 * WHY THESE ARE TYPED TABLES AND NOT MORE KEY/VALUE ASSUMPTIONS. A BOM line needs
 * a parent, a quantity, a scrap rate, a supplier and a tooling life before the
 * roll-up can even run; a role needs a start month and an end month before the
 * payroll stream exists. Folding them into the generic assumption ledger would
 * make the arithmetic un-typed and push the validation into the engine, which is
 * exactly where it cannot be enforced. The cost is a bigger migration surface, and
 * it is paid deliberately.
 *
 * `applyQuote` IS THE POINT OF THE WHOLE PACKAGE. A received quote does three
 * things in ONE transaction: it stores the quote, it writes a NEW assumption
 * revision with `source_kind = 'vendor-quote'` (superseding the estimate rather
 * than overwriting it), and it stamps the BOM line so the line's cost now resolves
 * through the quoted assumption. If any of the three fails, none of them happen —
 * a line pointing at an assumption that was never written would read as quoted
 * while costing a guess.
 *
 * Every write column comes from a frozen allowlist. A caller cannot name a column,
 * because the update helpers build their SET list from the allowlist and ignore
 * everything else in the body.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial implementation — owner-scoped BOM/vendor/quote/schedule/headcount CRUD, the transactional applyQuote that supersedes an estimate with a real quote and re-points the BOM line at it, and the bot-authored bulk replacements that never touch operator-entered rows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind every foreign quote to immutable FX evidence, keep original and reporting-currency micros distinct, and refuse cross-owner vendor or BOM references.
 *
 * @module venture-store-supply
 */

import type { Pool, PoolClient } from 'pg';
import { createChildLogger } from '@/shared/logger';
import { getVenture, upsertAssumptionOnClient } from './venture-store';
import { getFxAssumption } from './venture-store-fx';
import {
  assertCurrencyMicros, convertCurrencyMicros, normalizeCurrencyCode, VentureFxError,
} from './venture-currency';
import type {
  Assumption, AssumptionInput, BomLine, Confidence, HeadcountRow, Quote, ScheduleTask,
  SourceKind, Vendor,
} from './venture-types';

const log = createChildLogger({ module: 'venture-store-supply' });

/** Cap on rows any list read returns. A 500-line BOM is already a design smell. */
const LIST_LIMIT = 500;

/** Map a vendors row to the API shape. */
function toVendor(r: Record<string, any>): Vendor {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id), ventureId: String(r.venture_id), name: String(r.name), kind: String(r.kind),
    country: r.country ?? null, url: r.url ?? null, contact: r.contact ?? null,
    moq: num(r.moq), leadTimeDays: num(r.lead_time_days), qualificationDays: num(r.qualification_days),
    depositBps: Number(r.deposit_bps), balanceNetDays: Number(r.balance_net_days),
    qualified: r.qualified === true, notes: r.notes ?? null, status: String(r.status),
    sourceKind: String(r.source_kind) as SourceKind, confidence: String(r.confidence) as Confidence,
  };
}

/** Map a BOM row to the API shape. */
function toBomLine(r: Record<string, any>): BomLine {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id), ventureId: String(r.venture_id),
    parentLineId: r.parent_line_id ? String(r.parent_line_id) : null,
    ref: String(r.ref), partName: String(r.part_name), specText: r.spec_text ?? null,
    qtyPerUnit: Number(r.qty_per_unit), uom: String(r.uom), discrete: r.discrete === true,
    material: r.material ?? null, process: r.process ?? null, makeOrBuy: String(r.make_or_buy),
    unitCostMicros: num(r.unit_cost_micros), lowMicros: num(r.low_micros), highMicros: num(r.high_micros),
    scrapPct: Number(r.scrap_pct), moq: num(r.moq), leadTimeDays: num(r.lead_time_days),
    toolingCostMicros: Number(r.tooling_cost_micros), toolingLifeUnits: num(r.tooling_life_units),
    vendorId: r.vendor_id ? String(r.vendor_id) : null,
    assumptionKey: r.assumption_key ?? null,
    htsCode: r.hts_code ?? null, dutyPct: num(r.duty_pct),
    sourceKind: String(r.source_kind) as SourceKind, confidence: String(r.confidence) as Confidence,
    sortOrder: Number(r.sort_order),
  };
}

/**
 * @description List a venture's BOM lines, parents before children within a level.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The flat line set; the tree is rebuilt by the composer.
 */
export async function listBom(pool: Pool, ownerSub: string, ventureId: string): Promise<BomLine[]> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_bom_lines WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY sort_order, created_at LIMIT $3`,
    [ventureId, ownerSub, LIST_LIMIT],
  );
  return rows.map(toBomLine);
}

/** Every column a BOM write may set, mapped to its database name. Frozen. */
const BOM_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  parentLineId: 'parent_line_id', ref: 'ref', partName: 'part_name', specText: 'spec_text',
  qtyPerUnit: 'qty_per_unit', uom: 'uom', discrete: 'discrete', material: 'material',
  process: 'process', makeOrBuy: 'make_or_buy', unitCostMicros: 'unit_cost_micros',
  lowMicros: 'low_micros', highMicros: 'high_micros', scrapPct: 'scrap_pct', moq: 'moq',
  leadTimeDays: 'lead_time_days', toolingCostMicros: 'tooling_cost_micros',
  toolingLifeUnits: 'tooling_life_units', vendorId: 'vendor_id', assumptionKey: 'assumption_key',
  htsCode: 'hts_code', dutyPct: 'duty_pct', sourceKind: 'source_kind', confidence: 'confidence',
  sortOrder: 'sort_order',
});

/**
 * @description Insert one BOM line.
 *
 * Column names come from the frozen allowlist, so an unexpected body key is
 * dropped rather than interpolated. `ref` and `partName` are required by the
 * schema; everything else falls to a column default.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param line - Partial line; unknown keys ignored.
 * @returns The stored line.
 */
export async function insertBomLine(
  pool: Pool, ownerSub: string, ventureId: string, line: Record<string, unknown>,
): Promise<BomLine> {
  const cols = ['venture_id', 'owner_sub'];
  const params: unknown[] = [ventureId, ownerSub];
  for (const [field, column] of Object.entries(BOM_COLUMNS)) {
    if (line[field] === undefined) continue;
    params.push(line[field]);
    cols.push(column);
  }
  const placeholders = params.map((_v, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `INSERT INTO venture_bom_lines (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
    params,
  );
  return toBomLine(rows[0]);
}

/**
 * @description Update one BOM line, scoped to its owner.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param lineId - Line id.
 * @param patch - Partial line; unknown keys ignored.
 * @returns The updated line, or null when it is not the caller's.
 */
export async function updateBomLine(
  pool: Pool, ownerSub: string, ventureId: string, lineId: string, patch: Record<string, unknown>,
): Promise<BomLine | null> {
  const sets: string[] = [];
  const params: unknown[] = [lineId, ventureId, ownerSub];
  for (const [field, column] of Object.entries(BOM_COLUMNS)) {
    if (patch[field] === undefined) continue;
    params.push(patch[field]);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE venture_bom_lines SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND venture_id = $2 AND owner_sub = $3 RETURNING *`,
    params,
  );
  return rows.length ? toBomLine(rows[0]) : null;
}

/**
 * @description Delete a BOM line and everything under it.
 *
 * The children go by database cascade rather than a recursive delete here, so a
 * partial failure cannot leave orphans whose parent no longer exists.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param lineId - Line id.
 * @returns True when a line belonging to this owner was removed.
 */
export async function deleteBomSubtree(
  pool: Pool, ownerSub: string, ventureId: string, lineId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM venture_bom_lines WHERE id = $1 AND venture_id = $2 AND owner_sub = $3',
    [lineId, ventureId, ownerSub],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * @description Replace every MODEL-AUTHORED BOM line with a fresh bot draft.
 *
 * Operator-entered and quoted lines survive: a research re-run must never delete
 * the line whose price somebody phoned a supplier for. The delete predicate is
 * `source_kind = 'model-estimate'` for exactly that reason.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param lines - Parsed lines from the BOM analyst's contract.
 * @returns How many lines were removed and how many were written.
 */
export async function replaceBomFromBot(
  pool: Pool, ownerSub: string, ventureId: string, lines: ReadonlyArray<Record<string, unknown>>,
): Promise<{ removed: number; written: number }> {
  const del = await pool.query(
    `DELETE FROM venture_bom_lines WHERE venture_id = $1 AND owner_sub = $2
       AND source_kind = 'model-estimate'`,
    [ventureId, ownerSub],
  );
  let written = 0;
  for (const line of lines) {
    try {
      await insertBomLine(pool, ownerSub, ventureId, line);
      written += 1;
    } catch (err: any) {
      log.error({ err, stack: err?.stack, ventureId, ref: line.ref }, 'BOM line rejected');
    }
  }
  log.info({ ownerSub, ventureId, removed: del.rowCount ?? 0, written }, 'BOM redrafted from bot output');
  return { removed: del.rowCount ?? 0, written };
}

/**
 * @description List a venture's vendors.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The vendors, by name.
 */
export async function listVendors(pool: Pool, ownerSub: string, ventureId: string): Promise<Vendor[]> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_vendors WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY name LIMIT $3`,
    [ventureId, ownerSub, LIST_LIMIT],
  );
  return rows.map(toVendor);
}

/** Read one vendor without exposing a foreign owner's matching id. */
export async function getVendor(
  pool: Pool, ownerSub: string, ventureId: string, vendorId: string,
): Promise<Vendor | null> {
  const { rows } = await pool.query(
    'SELECT * FROM venture_vendors WHERE id = $1 AND venture_id = $2 AND owner_sub = $3',
    [vendorId, ventureId, ownerSub],
  );
  return rows.length ? toVendor(rows[0]) : null;
}

/** Every column a vendor write may set. Frozen. */
const VENDOR_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  name: 'name', kind: 'kind', country: 'country', url: 'url', contact: 'contact',
  moq: 'moq', leadTimeDays: 'lead_time_days', qualificationDays: 'qualification_days',
  depositBps: 'deposit_bps', balanceNetDays: 'balance_net_days', qualified: 'qualified',
  notes: 'notes', status: 'status', sourceKind: 'source_kind', confidence: 'confidence',
});

/**
 * @description Insert one vendor.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param v - Partial vendor; unknown keys ignored. `name` is required.
 * @returns The stored vendor.
 */
export async function insertVendor(
  pool: Pool, ownerSub: string, ventureId: string, v: Record<string, unknown>,
): Promise<Vendor> {
  const cols = ['venture_id', 'owner_sub'];
  const params: unknown[] = [ventureId, ownerSub];
  for (const [field, column] of Object.entries(VENDOR_COLUMNS)) {
    if (v[field] === undefined) continue;
    params.push(v[field]);
    cols.push(column);
  }
  const placeholders = params.map((_x, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `INSERT INTO venture_vendors (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
    params,
  );
  return toVendor(rows[0]);
}

/**
 * @description Update one vendor, scoped to its owner.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param vendorId - Vendor id.
 * @param patch - Partial vendor; unknown keys ignored.
 * @returns The updated vendor, or null.
 */
export async function updateVendor(
  pool: Pool, ownerSub: string, ventureId: string, vendorId: string, patch: Record<string, unknown>,
): Promise<Vendor | null> {
  const sets: string[] = [];
  const params: unknown[] = [vendorId, ventureId, ownerSub];
  for (const [field, column] of Object.entries(VENDOR_COLUMNS)) {
    if (patch[field] === undefined) continue;
    params.push(patch[field]);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return null;
  const { rows } = await pool.query(
    `UPDATE venture_vendors SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND venture_id = $2 AND owner_sub = $3 RETURNING *`,
    params,
  );
  return rows.length ? toVendor(rows[0]) : null;
}

/** Map a quotes row to the API shape. */
function toQuote(r: Record<string, any>): Quote {
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    id: String(r.id), ventureId: String(r.venture_id), vendorId: String(r.vendor_id),
    bomLineId: r.bom_line_id ? String(r.bom_line_id) : null,
    qtyBreak: Number(r.qty_break), unitCostMicros: Number(r.unit_cost_micros),
    currency: String(r.currency), toolingCostMicros: Number(r.tooling_cost_micros),
    reportingUnitCostMicros: num(r.reporting_unit_cost_micros),
    reportingCurrency: r.reporting_currency ? String(r.reporting_currency) : null,
    reportingToolingCostMicros: num(r.reporting_tooling_cost_micros),
    fxAssumptionId: r.fx_assumption_id ? String(r.fx_assumption_id) : null,
    incoterm: r.incoterm ?? null,
    leadTimeDays: r.lead_time_days === null ? null : Number(r.lead_time_days),
    validUntil: r.valid_until ? new Date(r.valid_until).toISOString().slice(0, 10) : null,
    documentRef: r.document_ref ?? null, notes: r.notes ?? null,
    assumptionId: r.assumption_id ? String(r.assumption_id) : null,
    receivedAt: new Date(r.received_at).toISOString(),
  };
}

/**
 * @description List a venture's received quotes, newest first.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The quotes.
 */
export async function listQuotes(pool: Pool, ownerSub: string, ventureId: string): Promise<Quote[]> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_quotes WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY received_at DESC LIMIT $3`,
    [ventureId, ownerSub, LIST_LIMIT],
  );
  return rows.map(toQuote);
}

/** What `applyQuote` needs to record a received price. */
export interface QuoteInput {
  vendorId: string;
  bomLineId?: string | null;
  qtyBreak?: number;
  unitCostMicros: number;
  currency?: string;
  /** Mandatory immutable rate snapshot for a foreign-currency quote. */
  fxAssumptionId?: string | null;
  toolingCostMicros?: number;
  incoterm?: string | null;
  leadTimeDays?: number | null;
  validUntil?: string | null;
  documentRef?: string | null;
  notes?: string | null;
  /** Assumption key the quote replaces. Defaults to the BOM line's own key. */
  assumptionKey?: string | null;
  label?: string;
}

/** Original and converted quote amounts resolved before any write occurs. */
interface QuoteCurrencyBinding {
  sourceCurrency: string;
  reportingCurrency: string;
  sourceUnitMicros: number;
  reportingUnitMicros: number;
  sourceToolingMicros: number;
  reportingToolingMicros: number;
  fxAssumptionId: string | null;
  fxSourceDetail: string | null;
}

/** Resolve and validate the immutable conversion before quote provenance changes. */
async function bindQuoteCurrency(
  pool: Pool, ownerSub: string, ventureId: string, q: QuoteInput,
): Promise<QuoteCurrencyBinding> {
  const venture = await getVenture(pool, ownerSub, ventureId);
  if (!venture) throw new VentureFxError('fx_venture_not_found', 'venture is missing or not owned by the caller');
  const sourceCurrency = normalizeCurrencyCode(q.currency ?? venture.currency, 'currency');
  const reportingCurrency = normalizeCurrencyCode(venture.currency, 'venture currency');
  const sourceUnitMicros = assertCurrencyMicros(q.unitCostMicros, 'unitCostMicros');
  const sourceToolingMicros = assertCurrencyMicros(q.toolingCostMicros ?? 0, 'toolingCostMicros');
  if (sourceUnitMicros < 0 || sourceToolingMicros < 0) {
    throw new VentureFxError('invalid_currency_amount', 'quote amounts cannot be negative');
  }
  if (sourceCurrency === reportingCurrency) {
    if (q.fxAssumptionId) {
      throw new VentureFxError('redundant_fx_assumption', 'same-currency quotes must not bind an FX assumption');
    }
    return {
      sourceCurrency, reportingCurrency, sourceUnitMicros, sourceToolingMicros,
      reportingUnitMicros: sourceUnitMicros, reportingToolingMicros: sourceToolingMicros,
      fxAssumptionId: null, fxSourceDetail: null,
    };
  }
  if (!q.fxAssumptionId) {
    throw new VentureFxError('fx_assumption_required', 'foreign quotes require an immutable fxAssumptionId');
  }
  const fx = await getFxAssumption(pool, ownerSub, ventureId, q.fxAssumptionId);
  if (!fx) throw new VentureFxError('fx_assumption_not_found', 'FX assumption is missing or not owned by the caller');
  if (fx.sourceCurrency !== sourceCurrency || fx.reportingCurrency !== reportingCurrency) {
    throw new VentureFxError('fx_assumption_mismatch', 'FX assumption currencies do not match the quote and venture');
  }
  return {
    sourceCurrency, reportingCurrency, sourceUnitMicros, sourceToolingMicros,
    reportingUnitMicros: convertCurrencyMicros(sourceUnitMicros, fx),
    reportingToolingMicros: convertCurrencyMicros(sourceToolingMicros, fx),
    fxAssumptionId: fx.id,
    fxSourceDetail: `FX ${fx.id} ${fx.sourceCurrency}->${fx.reportingCurrency} @ ${fx.rateNanos} nanos`,
  };
}

/** Build the reporting-currency assumption that a human-received quote proves. */
function quotedAssumptionInput(
  q: QuoteInput, line: BomLine | null, key: string, money: QuoteCurrencyBinding,
): AssumptionInput {
  return {
    key,
    domain: 'manufacturing',
    label: q.label || (line ? `${line.partName} unit cost (quoted)` : `Quoted unit cost for ${key}`),
    unit: 'micros',
    valueNum: money.reportingUnitMicros,
    lowNum: money.reportingUnitMicros,
    highNum: money.reportingUnitMicros,
    sourceKind: 'vendor-quote',
    sourceDetail: [q.documentRef || `vendor ${q.vendorId} @ qty ${q.qtyBreak ?? 1}`,
      money.fxSourceDetail].filter(Boolean).join('; '),
    confidence: 'high',
  };
}

/** Insert the quote with original and reporting amounts kept in separate columns. */
async function insertQuoteRow(
  client: PoolClient, ownerSub: string, ventureId: string, q: QuoteInput,
  money: QuoteCurrencyBinding, assumptionId: string | null,
): Promise<Quote> {
  const { rows } = await client.query(
    `INSERT INTO venture_quotes (venture_id, owner_sub, vendor_id, bom_line_id, qty_break,
       unit_cost_micros, currency, tooling_cost_micros, reporting_unit_cost_micros,
       reporting_currency, reporting_tooling_cost_micros, fx_assumption_id, incoterm,
       lead_time_days, valid_until, document_ref, notes, assumption_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [ventureId, ownerSub, q.vendorId, q.bomLineId ?? null, q.qtyBreak ?? 1,
      money.sourceUnitMicros, money.sourceCurrency, money.sourceToolingMicros,
      money.reportingUnitMicros, money.reportingCurrency, money.reportingToolingMicros,
      money.fxAssumptionId, q.incoterm ?? null, q.leadTimeDays ?? null,
      q.validUntil ?? null, q.documentRef ?? null, q.notes ?? null, assumptionId],
  );
  return toQuote(rows[0]);
}

/** Point a quoted BOM line at the reporting-currency amount inside the transaction. */
async function markLineQuoted(
  client: PoolClient, ownerSub: string, ventureId: string,
  line: BomLine, key: string, reportingUnitMicros: number,
): Promise<void> {
  await client.query(
    `UPDATE venture_bom_lines SET unit_cost_micros = $4, low_micros = $4, high_micros = $4,
       assumption_key = $5, source_kind = 'vendor-quote', confidence = 'high', updated_at = NOW()
     WHERE id = $1 AND venture_id = $2 AND owner_sub = $3`,
    [line.id, ventureId, ownerSub, reportingUnitMicros, key],
  );
}

/**
 * @description Record a supplier quote and let it supersede the estimate it replaces.
 *
 * The three writes are one unit of work by construction: the assumption revision
 * lands first (so its id exists), then the quote row referencing it, then the BOM
 * line is re-pointed at the key. A failure anywhere leaves the previous estimate
 * live, which is the safe direction — a plan that still says "estimated" is merely
 * out of date, while a line that says "quoted" and costs a guess is a lie.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param q - The quote.
 * @returns The stored quote and the assumption revision it wrote.
 */
export async function applyQuote(
  pool: Pool, ownerSub: string, ventureId: string, q: QuoteInput,
): Promise<{ quote: Quote; assumption: Assumption | null; supersededId: string | null }> {
  // Resolve every owned reference and currency input before changing
  // provenance. UUID knowledge alone must never bind a quote to another
  // tenant's vendor or BOM line.
  const [money, vendor, line] = await Promise.all([
    bindQuoteCurrency(pool, ownerSub, ventureId, q),
    getVendor(pool, ownerSub, ventureId, q.vendorId),
    q.bomLineId ? getBomLine(pool, ownerSub, ventureId, q.bomLineId) : Promise.resolve(null),
  ]);
  if (!vendor) {
    throw new VentureFxError('quote_vendor_not_found', 'vendor is missing or not owned by the caller');
  }
  if (q.bomLineId && !line) {
    throw new VentureFxError('quote_bom_line_not_found', 'BOM line is missing or not owned by the caller');
  }
  const key = q.assumptionKey || line?.assumptionKey || (line ? `bom.${line.ref}.unit-cost` : null);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const written = key
      ? await upsertAssumptionOnClient(
        client, ownerSub, ventureId, quotedAssumptionInput(q, line, key, money),
        `user:${ownerSub}`, null,
      ) : null;
    const quote = await insertQuoteRow(
      client, ownerSub, ventureId, q, money, written?.assumption.id ?? null,
    );
    if (line && key) await markLineQuoted(
      client, ownerSub, ventureId, line, key, money.reportingUnitMicros,
    );
    await client.query('COMMIT');
    log.info({
      ownerSub, ventureId, vendorId: q.vendorId, key,
      supersededId: written?.supersededId ?? null,
      sourceCurrency: money.sourceCurrency, reportingCurrency: money.reportingCurrency,
      fxAssumptionId: money.fxAssumptionId,
    }, 'quote applied');
    return {
      quote,
      assumption: written?.assumption ?? null,
      supersededId: written?.supersededId ?? null,
    };
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    log.error({ err, stack: err?.stack, ownerSub, ventureId }, 'quote application failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @description Read one BOM line, scoped to its owner.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param lineId - Line id.
 * @returns The line, or null.
 */
export async function getBomLine(
  pool: Pool, ownerSub: string, ventureId: string, lineId: string,
): Promise<BomLine | null> {
  const { rows } = await pool.query(
    'SELECT * FROM venture_bom_lines WHERE id = $1 AND venture_id = $2 AND owner_sub = $3',
    [lineId, ventureId, ownerSub],
  );
  return rows.length ? toBomLine(rows[0]) : null;
}

/** Map a schedule row to the API shape. */
function toScheduleTask(r: Record<string, any>): ScheduleTask {
  return {
    id: String(r.id), ventureId: String(r.venture_id), phase: String(r.phase), name: String(r.name),
    ownerRole: r.owner_role ?? null, durationDays: Number(r.duration_days),
    dependsOn: Array.isArray(r.depends_on) ? r.depends_on.map(String) : [],
    assumptionKey: r.assumption_key ?? null,
    sourceKind: String(r.source_kind) as SourceKind, confidence: String(r.confidence) as Confidence,
    sortOrder: Number(r.sort_order),
  };
}

/**
 * @description List a venture's schedule tasks in plan order.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The tasks.
 */
export async function listScheduleTasks(
  pool: Pool, ownerSub: string, ventureId: string,
): Promise<ScheduleTask[]> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_schedule_tasks WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY sort_order, created_at LIMIT $3`,
    [ventureId, ownerSub, LIST_LIMIT],
  );
  return rows.map(toScheduleTask);
}

/**
 * @description Replace the model-authored schedule with a fresh bot draft.
 *
 * Same rule as the BOM: operator-entered tasks survive a re-run.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param tasks - Parsed tasks from the ops analyst's contract.
 * @returns How many were written.
 */
export async function replaceScheduleTasks(
  pool: Pool, ownerSub: string, ventureId: string,
  tasks: ReadonlyArray<{ phase: string; name: string; ownerRole?: string | null;
    durationDays: number; dependsOn?: string[]; confidence: Confidence }>,
): Promise<number> {
  await pool.query(
    `DELETE FROM venture_schedule_tasks WHERE venture_id = $1 AND owner_sub = $2
       AND source_kind = 'model-estimate'`,
    [ventureId, ownerSub],
  );
  let written = 0;
  for (const [i, t] of tasks.entries()) {
    await pool.query(
      `INSERT INTO venture_schedule_tasks (venture_id, owner_sub, phase, name, owner_role,
         duration_days, depends_on, confidence, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [ventureId, ownerSub, t.phase, t.name, t.ownerRole ?? null, t.durationDays,
        JSON.stringify(t.dependsOn ?? []), t.confidence, i],
    );
    written += 1;
  }
  return written;
}

/** Map a headcount row to the API shape. */
function toHeadcount(r: Record<string, any>): HeadcountRow {
  return {
    id: String(r.id), ventureId: String(r.venture_id), role: String(r.role),
    kind: String(r.kind) as HeadcountRow['kind'], fte: Number(r.fte),
    startMonth: Number(r.start_month), endMonth: r.end_month === null ? null : Number(r.end_month),
    baseSalaryMicros: Number(r.base_salary_micros), burdenBps: Number(r.burden_bps),
    recruitCostMicros: Number(r.recruit_cost_micros), assumptionKey: r.assumption_key ?? null,
    sourceKind: String(r.source_kind) as SourceKind, confidence: String(r.confidence) as Confidence,
    sortOrder: Number(r.sort_order),
  };
}

/**
 * @description List a venture's planned roles.
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @returns The roles in plan order.
 */
export async function listHeadcount(
  pool: Pool, ownerSub: string, ventureId: string,
): Promise<HeadcountRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM venture_headcount WHERE venture_id = $1 AND owner_sub = $2
     ORDER BY sort_order, created_at LIMIT $3`,
    [ventureId, ownerSub, LIST_LIMIT],
  );
  return rows.map(toHeadcount);
}

/**
 * @description Replace the model-authored roles with a fresh bot draft.
 *
 * The burden multiplier stored here is PLAN ALTITUDE. The payroll package computes
 * the real employer cost of an employee; this is a labelled assumption for a
 * forecast, and the org document says so rather than implying the two agree.
 *
 * @param pool - Shared pool.
 * @param ownerSub - The authenticated caller's sub.
 * @param ventureId - Venture id.
 * @param roles - Parsed roles from the ops analyst's contract.
 * @returns How many were written.
 */
export async function replaceHeadcount(
  pool: Pool, ownerSub: string, ventureId: string,
  roles: ReadonlyArray<{ role: string; kind: 'employee' | 'contractor'; fte: number;
    startMonth: number; endMonth?: number | null; baseSalaryMicros: number;
    burdenBps: number; confidence: Confidence }>,
): Promise<number> {
  await pool.query(
    `DELETE FROM venture_headcount WHERE venture_id = $1 AND owner_sub = $2
       AND source_kind = 'model-estimate'`,
    [ventureId, ownerSub],
  );
  let written = 0;
  for (const [i, r] of roles.entries()) {
    await pool.query(
      `INSERT INTO venture_headcount (venture_id, owner_sub, role, kind, fte, start_month,
         end_month, base_salary_micros, burden_bps, confidence, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ventureId, ownerSub, r.role, r.kind, r.fte, r.startMonth, r.endMonth ?? null,
        r.baseSalaryMicros, r.burdenBps, r.confidence, i],
    );
    written += 1;
  }
  return written;
}
