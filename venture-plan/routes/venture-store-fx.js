"use strict";
/**
 * Venture Plan - append-only, owner-scoped FX assumption persistence.
 *
 * A rate is evidence, not configuration. Once a foreign quote points at one,
 * changing the rate in place would rewrite the historical cost of the quote and
 * every model built from it. This store therefore exposes insert/read/list only;
 * the database trigger rejects UPDATE and DELETE outside a venture cascade.
 *
 * Inserts carry an idempotency key. Reusing a key with byte-equivalent business
 * values returns the original row. Reusing it with a different rate or source
 * fails closed rather than silently rebinding a retry to different evidence.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add immutable owner-scoped FX assumptions with exact retry idempotency and conflict refusal.
 *
 * @module venture-store-fx
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertFxAssumption = insertFxAssumption;
exports.listFxAssumptions = listFxAssumptions;
exports.getFxAssumption = getFxAssumption;
const logger_1 = require("@/shared/logger");
const venture_currency_1 = require("./venture-currency");
const log = (0, logger_1.createChildLogger)({ module: 'venture-store-fx' });
const FX_SOURCE_KINDS = Object.freeze([
    'user-entered', 'published-source', 'vendor-quote',
]);
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
/** Convert a database row to an immutable API value. */
function toFxAssumption(row) {
    const core = (0, venture_currency_1.freezeFxSnapshot)({
        id: String(row.id),
        sourceCurrency: String(row.source_currency),
        reportingCurrency: String(row.reporting_currency),
        rateNanos: Number(row.rate_nanos),
    });
    return Object.freeze({
        ...core,
        ventureId: String(row.venture_id),
        sourceKind: String(row.source_kind),
        sourceRef: String(row.source_ref),
        observedAt: new Date(row.observed_at).toISOString(),
        idempotencyKey: String(row.idempotency_key),
        authoredBy: String(row.authored_by),
        createdAt: new Date(row.created_at).toISOString(),
    });
}
/** Validate and normalize user-controlled FX evidence. */
function normalizeInput(input) {
    const sourceCurrency = (0, venture_currency_1.normalizeCurrencyCode)(input.sourceCurrency, 'sourceCurrency');
    const reportingCurrency = (0, venture_currency_1.normalizeCurrencyCode)(input.reportingCurrency, 'reportingCurrency');
    if (sourceCurrency === reportingCurrency) {
        throw new venture_currency_1.VentureFxError('redundant_fx_assumption', 'source and reporting currencies must differ');
    }
    if (!FX_SOURCE_KINDS.includes(input.sourceKind)) {
        throw new venture_currency_1.VentureFxError('invalid_fx_source', 'sourceKind is not valid FX evidence');
    }
    const sourceRef = String(input.sourceRef ?? '').trim();
    if (!sourceRef || sourceRef.length > 500) {
        throw new venture_currency_1.VentureFxError('invalid_fx_source', 'sourceRef is required and must be at most 500 characters');
    }
    const idempotencyKey = String(input.idempotencyKey ?? '').trim();
    if (!IDEMPOTENCY_RE.test(idempotencyKey)) {
        throw new venture_currency_1.VentureFxError('invalid_idempotency_key', 'idempotencyKey must be 8-128 safe characters');
    }
    const observed = new Date(input.observedAt);
    if (!Number.isFinite(observed.valueOf())) {
        throw new venture_currency_1.VentureFxError('invalid_fx_observed_at', 'observedAt must be an ISO timestamp');
    }
    return {
        sourceCurrency,
        reportingCurrency,
        rateNanos: (0, venture_currency_1.assertFxRateNanos)(input.rateNanos),
        sourceKind: input.sourceKind,
        sourceRef,
        observedAt: observed.toISOString(),
        idempotencyKey,
    };
}
/** True only when a retry names the exact same immutable evidence. */
function sameInput(row, input, authoredBy) {
    return row.sourceCurrency === input.sourceCurrency
        && row.reportingCurrency === input.reportingCurrency
        && row.rateNanos === input.rateNanos
        && row.sourceKind === input.sourceKind
        && row.sourceRef === input.sourceRef
        && row.observedAt === input.observedAt
        && row.idempotencyKey === input.idempotencyKey
        && row.authoredBy === authoredBy;
}
/**
 * @description Insert one immutable FX assumption, or return the original row
 *   for an exact idempotent retry.
 * @param pool - Shared Postgres pool.
 * @param ownerSub - Authenticated venture owner.
 * @param ventureId - Owner-scoped venture id.
 * @param input - Validated rate evidence and retry key.
 * @param authoredBy - Accountable `user:<sub>` author.
 * @returns The immutable row and whether this call inserted it.
 */
async function insertFxAssumption(pool, ownerSub, ventureId, input, authoredBy) {
    const value = normalizeInput(input);
    const attempted = await pool.query(`WITH inserted AS (
       INSERT INTO venture_fx_assumptions
         (venture_id, owner_sub, source_currency, reporting_currency, rate_nanos,
          source_kind, source_ref, observed_at, idempotency_key, authored_by)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         FROM venture_ventures
        WHERE id = $1 AND owner_sub = $2
       ON CONFLICT (venture_id, idempotency_key) DO NOTHING
       RETURNING *, TRUE AS was_inserted
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT existing.*, FALSE AS was_inserted
       FROM venture_fx_assumptions existing
      WHERE existing.venture_id = $1 AND existing.owner_sub = $2
        AND existing.idempotency_key = $9 AND NOT EXISTS (SELECT 1 FROM inserted)
     LIMIT 1`, [ventureId, ownerSub, value.sourceCurrency, value.reportingCurrency, value.rateNanos,
        value.sourceKind, value.sourceRef, value.observedAt, value.idempotencyKey, authoredBy]);
    let row = attempted.rows[0];
    if (!row) {
        // Under READ COMMITTED, INSERT .. ON CONFLICT may wait for a concurrent
        // transaction whose row was not visible to the statement's original
        // snapshot. Read again in a new statement so a simultaneous exact retry is
        // idempotent instead of being misreported as a missing venture.
        const replay = await pool.query(`SELECT * FROM venture_fx_assumptions
        WHERE venture_id = $1 AND owner_sub = $2 AND idempotency_key = $3`, [ventureId, ownerSub, value.idempotencyKey]);
        row = replay.rows[0];
    }
    if (!row) {
        throw new venture_currency_1.VentureFxError('fx_venture_not_found', 'venture is missing or is not owned by the caller');
    }
    const assumption = toFxAssumption(row);
    const inserted = row.was_inserted === true;
    if (!inserted && !sameInput(assumption, value, authoredBy)) {
        throw new venture_currency_1.VentureFxError('fx_idempotency_conflict', 'idempotencyKey already names different immutable FX evidence');
    }
    log.info({ ownerSub, ventureId, fxAssumptionId: assumption.id, inserted }, 'FX assumption recorded');
    return { assumption, inserted };
}
/**
 * @description List immutable FX assumptions for one owned venture.
 * @param pool - Shared Postgres pool.
 * @param ownerSub - Authenticated venture owner.
 * @param ventureId - Venture id.
 * @returns Newest evidence first.
 */
async function listFxAssumptions(pool, ownerSub, ventureId) {
    const { rows } = await pool.query(`SELECT * FROM venture_fx_assumptions
      WHERE venture_id = $1 AND owner_sub = $2
      ORDER BY observed_at DESC, created_at DESC LIMIT 500`, [ventureId, ownerSub]);
    return rows.map(toFxAssumption);
}
/**
 * @description Read one FX assumption without exposing whether another owner has it.
 * @param pool - Shared Postgres pool.
 * @param ownerSub - Authenticated venture owner.
 * @param ventureId - Venture id.
 * @param assumptionId - FX assumption id.
 * @returns The immutable assumption, or null for missing/foreign rows.
 */
async function getFxAssumption(pool, ownerSub, ventureId, assumptionId) {
    const { rows } = await pool.query(`SELECT * FROM venture_fx_assumptions
      WHERE id = $1 AND venture_id = $2 AND owner_sub = $3`, [assumptionId, ventureId, ownerSub]);
    return rows.length ? toFxAssumption(rows[0]) : null;
}
//# sourceMappingURL=venture-store-fx.js.map