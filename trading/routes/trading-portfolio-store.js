"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprint = fingerprint;
exports.listRecords = listRecords;
exports.getRecord = getRecord;
exports.saveRecord = saveRecord;
exports.removeRecord = removeRecord;
exports.savePlanApprovalOnce = savePlanApprovalOnce;
/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep heavy planning evidence separate from recent preview listings, count records without loading payloads, and preserve the first concurrent planning approval with insert-once semantics.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Persist owner-isolated immutable portfolio research and bounded mutable account declarations through the native governed SQL port.
 */
const node_crypto_1 = require("node:crypto");
const trading_portfolio_model_1 = require("./trading-portfolio-model");
function fingerprint(value) {
    const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
async function listRecords(ctx, owner, kind, limit = 500) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new trading_portfolio_model_1.PortfolioError(400, 'record_limit_invalid', 'Invalid internal record page limit.');
    const rows = (await ctx.pool.query(`SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 ORDER BY created_at DESC LIMIT ${limit === 500 ? 501 : limit}`, [owner, kind])).rows;
    if (rows.length > 500)
        throw new trading_portfolio_model_1.PortfolioError(409, 'record_limit', 'Archive older research before adding more records.');
    return rows.map(row => ({ ...JSON.parse(String(row.payload)), id: String(row.record_id), createdAt: new Date(row.created_at).toISOString() }));
}
async function getRecord(ctx, owner, kind, id) {
    if (typeof id !== 'string' || id.length > 100)
        throw new trading_portfolio_model_1.PortfolioError(400, 'record_required', 'Select a saved record.');
    const row = (await ctx.pool.query('SELECT record_id, payload, created_at FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 AND record_id=$3', [owner, kind, id])).rows[0];
    if (!row)
        throw new trading_portfolio_model_1.PortfolioError(404, 'record_not_found', 'This saved record was not found for your account.');
    return { ...JSON.parse(String(row.payload)), id: String(row.record_id), createdAt: new Date(row.created_at).toISOString() };
}
async function saveRecord(ctx, owner, kind, data, key) {
    const id = key ? `${kind}:${fingerprint([owner, key])}` : (0, node_crypto_1.randomUUID)(), createdAt = new Date().toISOString();
    const payload = JSON.stringify(data);
    if (Buffer.byteLength(payload) > 1500000)
        throw new trading_portfolio_model_1.PortfolioError(413, 'record_too_large', 'This research record exceeds the storage limit.');
    if (!key && (await ctx.pool.query('SELECT record_id FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 LIMIT 501', [owner, kind])).rows.length >= 500)
        throw new trading_portfolio_model_1.PortfolioError(409, 'record_limit', 'Archive older research before adding more records.');
    await ctx.pool.query(`INSERT INTO oshal_trading_portfolio_records (record_id,user_sub,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5)
 ON CONFLICT (user_sub,record_id) DO UPDATE SET payload=EXCLUDED.payload,created_at=EXCLUDED.created_at`, [id, owner, kind, payload, createdAt]);
    return { ...data, id, createdAt };
}
async function removeRecord(ctx, owner, kind, id) {
    await getRecord(ctx, owner, kind, id);
    await ctx.pool.query('DELETE FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 AND record_id=$3', [owner, kind, id]);
}
/** Immutable, idempotent planning receipt: a concurrent retry cannot overwrite the first approval. */
async function savePlanApprovalOnce(ctx, owner, planId, data) {
    const id = 'plan-approval:' + fingerprint([owner, 'approval:' + planId]), createdAt = new Date().toISOString(), payload = JSON.stringify(data);
    if (Buffer.byteLength(payload) > 1500000)
        throw new trading_portfolio_model_1.PortfolioError(413, 'record_too_large', 'The planning receipt exceeds the storage limit.');
    const count = (await ctx.pool.query('SELECT record_id FROM oshal_trading_portfolio_records WHERE user_sub=$1 AND kind=$2 LIMIT 501', [owner, 'plan-approval'])).rows.length;
    if (count >= 500)
        throw new trading_portfolio_model_1.PortfolioError(409, 'record_limit', 'Archive older research before adding more records.');
    await ctx.pool.query('INSERT INTO oshal_trading_portfolio_records (record_id,user_sub,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_sub,record_id) DO NOTHING', [id, owner, 'plan-approval', payload, createdAt]);
    return getRecord(ctx, owner, 'plan-approval', id);
}
