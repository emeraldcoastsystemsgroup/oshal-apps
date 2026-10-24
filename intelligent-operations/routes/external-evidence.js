"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.externalConfig = externalConfig;
exports.saveExternalConfig = saveExternalConfig;
exports.ensureExternalEvidence = ensureExternalEvidence;
exports.externalRecords = externalRecords;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Capture optional bounded Splunk context under the original person's connector read, seal source/time/hash provenance beside the immutable packet, and record refusal without holding or erasing an incident. */
// @ts-nocheck
const node_crypto_1 = require("node:crypto");
const pipeline_1 = require("./pipeline");
const ID = 'external:splunk';
const INDEX = /^[A-Za-z0-9_-]{1,64}$/, ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/, RESOURCE = /^[A-Za-z0-9._:/@-]{1,128}$/;
const sha = value => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const ownerRequired = owner => { if (typeof owner !== 'string' || !owner)
    fail(401, 'A verified caller is required.'); };
const defaults = { enabled: false, account: 'primary', index: 'main', sourceIds: [], revision: 0 };
const REFUSED = /^(refused|invalid): |is not linked for this package/;
async function externalConfig(pool, owner) {
    ownerRequired(owner);
    return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, ID])).rows[0]?.record || { ...defaults };
}
async function saveExternalConfig(pool, owner, input, sources) {
    ownerRequired(owner);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['enabled', 'account', 'index', 'sourceIds', 'expectedRevision'].includes(k))
        || typeof input.enabled !== 'boolean' || !ACCOUNT.test(input.account) || !INDEX.test(input.index)
        || !Array.isArray(input.sourceIds) || input.sourceIds.length > 32 || new Set(input.sourceIds).size !== input.sourceIds.length
        || input.sourceIds.some(id => typeof id !== 'string' || !sources.includes(id))
        || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646
        || (input.enabled && !input.sourceIds.length))
        fail(400, 'Choose your Splunk account, index and up to 32 saved source revisions.');
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const previous = (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, ID])).rows[0]?.record;
        if ((previous?.revision || 0) !== input.expectedRevision)
            fail(409, 'Splunk enrichment settings changed; refresh before saving.');
        const record = { enabled: input.enabled, account: input.account, index: input.index, sourceIds: input.sourceIds.slice().sort(), revision: input.expectedRevision + 1, updatedAt: new Date().toISOString() };
        if (previous)
            await c.query('UPDATE operations_processing_config SET revision=$3,record=$4 WHERE user_sub=$1 AND id=$2', [owner, ID, record.revision, JSON.stringify(record)]);
        else
            await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,$3,$4)', [owner, ID, record.revision, JSON.stringify(record)]);
        return record;
    });
}
function scrub(value, max) {
    const text = String(value ?? '').slice(0, max);
    return text.replace(/authorization\s*:\s*bearer\s+[^\s,;]+/ig, 'Authorization: Bearer [redacted]')
        .replace(/\b(password|passwd|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]');
}
function limitedItems(answer) {
    if (!answer || answer.operation !== 'splunk-bounded-export' || !Array.isArray(answer.data?.items) || answer.data.items.length > 50)
        throw Error('Splunk returned an unexpected result shape.');
    const items = answer.data.items.slice(0, 12).map(row => ({
        time: scrub(row._time, 64), host: scrub(row.host, 128), source: scrub(row.source, 128),
        sourcetype: scrub(row.sourcetype, 80), message: scrub(row._raw, 600)
    }));
    // The original provider response may be larger; the attached model input is intentionally small.
    return { items, truncated: answer.data.items.length > 12 || answer.pageComplete === false };
}
function windowFor(alertAt) {
    const at = Date.parse(alertAt), now = Date.now();
    if (!Number.isFinite(at) || at > now + 5 * 60000)
        return null;
    const latest = Math.min(at + 5 * 60000, now), earliest = at - 10 * 60000;
    if (latest <= earliest)
        return null;
    return { earliest: new Date(earliest).toISOString(), latest: new Date(latest).toISOString() };
}
async function existing(pool, owner, id) {
    return (await pool.query('SELECT record FROM operations_external_evidence WHERE user_sub=$1 AND id=$2', [owner, id])).rows[0]?.record || null;
}
/** @description A final record is stable across later config changes and ticket re-reads; a stale in-flight read becomes an explicit gap. */
async function ensureExternalEvidence(ctx, owner, packet, sourceId) {
    ownerRequired(owner);
    let held = await existing(ctx.pool, owner, packet.id);
    if (held) {
        if (held.status !== 'pending')
            return held;
        if (Date.now() - Date.parse(held.requestedAt) < 30000)
            fail(409, 'Optional enrichment is in progress; retry this investigation after it finishes.');
        const stale = { ...held, status: 'unavailable', completedAt: new Date().toISOString(), reason: 'The connector read did not finish; no external events were attached.' };
        await ctx.pool.query("UPDATE operations_external_evidence SET record=$3 WHERE user_sub=$1 AND id=$2 AND record->>'status'='pending'", [owner, packet.id, JSON.stringify(stale)]);
        return await existing(ctx.pool, owner, packet.id);
    }
    const config = await externalConfig(ctx.pool, owner), window = windowFor(packet.alertAt);
    const base = { id: packet.id, packetSha256: packet.sha256, sourceId, resourceId: packet.resource?.id || null, provider: 'splunk', queryVersion: 'resource-window-v1', configurationRevision: config.revision, account: config.enabled ? config.account : null, index: config.enabled ? config.index : null, earliest: window?.earliest || null, latest: window?.latest || null, requestedAt: new Date().toISOString(), status: 'pending', items: [], truncated: false };
    const inserted = await ctx.pool.query('INSERT INTO operations_external_evidence(user_sub,id,created_at,record) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [owner, packet.id, base.requestedAt, JSON.stringify(base)]);
    if (!inserted.rowCount)
        return ensureExternalEvidence(ctx, owner, packet, sourceId);
    let outcome;
    if (!config.enabled || !config.sourceIds.includes(sourceId))
        outcome = { status: 'not-configured', reason: 'No Splunk enrichment is enabled for this source revision.' };
    else if (!window || !RESOURCE.test(packet.resource?.id || ''))
        outcome = { status: 'unsupported', reason: 'The alert time or resource identifier is outside the bounded Splunk query profile.' };
    else if (typeof ctx.intent !== 'function')
        outcome = { status: 'unavailable', reason: 'The kernel connector read port is unavailable.' };
    else
        try {
            const answer = await ctx.intent('connector.read', { connector: 'splunk', operation: 'splunk-bounded-export', account: config.account, input: { index: config.index, resourceId: packet.resource.id, ...window } });
            const result = limitedItems(answer);
            outcome = { status: result.items.length ? 'available' : 'empty', items: result.items, truncated: result.truncated, resultSha256: sha(result.items), reason: result.items.length ? 'Bounded provider results captured.' : 'The bounded search returned no events.' };
        }
        catch (error) {
            const message = String(error?.message || error);
            outcome = { status: REFUSED.test(message) ? 'refused' : 'unavailable', reason: REFUSED.test(message) ? 'Your Splunk connection or read grant was refused.' : 'The bounded Splunk read failed or timed out.' };
        }
    const record = { ...base, ...outcome, completedAt: new Date().toISOString() };
    await ctx.pool.query("UPDATE operations_external_evidence SET record=$3 WHERE user_sub=$1 AND id=$2 AND record->>'status'='pending'", [owner, packet.id, JSON.stringify(record)]);
    return await existing(ctx.pool, owner, packet.id);
}
async function externalRecords(pool, owner) {
    ownerRequired(owner);
    const rows = (await pool.query('SELECT record FROM operations_external_evidence WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 21', [owner])).rows;
    return { items: rows.slice(0, 20).map(r => r.record), truncated: rows.length > 20, limit: 20 };
}
