"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CORRELATION = void 0;
exports.processingConfig = processingConfig;
exports.saveProcessingConfig = saveProcessingConfig;
exports.claimProcessing = claimProcessing;
exports.processingFence = processingFence;
exports.processPending = processPending;
exports.retryProcessing = retryProcessing;
exports.processingRecords = processingRecords;
/** CHANGE LOG: automatic investigation | maintainer@emeraldcoastsystemsgroup.com | Hold the explicit opt-in for starting investigations automatically from captured evidence; it requires evidence capture. */
/** CHANGE LOG: automatic correlation | maintainer@emeraldcoastsystemsgroup.com | Hold the explicit opt-in and bounded versioned dependency policy for automatic post-reduction correlation on the scheduled tick. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Offer explicit scheduled retained-evidence capture and preserve its retry stage. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Drain admitted deliveries under native scheduled caller authority with durable leases, bounded retries and fencing. */
// @ts-nocheck
const node_crypto_1 = require("node:crypto");
const pipeline_1 = require("./pipeline");
const topology_model_1 = require("./topology-model");
const defaults = { enabled: false, captureEvidence: false, sourceIds: [], batchSize: 10, maxAttempts: 8, retrySeconds: 30, revision: 0 };
const ownerRequired = owner => { if (!(0, topology_model_1.clean)(owner))
    (0, topology_model_1.fail)(401, 'A verified caller is required.'); };
const stamp = clock => new Date(clock()).toISOString();
async function processingConfig(pool, owner, lock = false) { ownerRequired(owner); return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''), [owner, 'worker'])).rows[0]?.record || { ...defaults }; }
exports.DEFAULT_CORRELATION = { id: 'scheduled-dependencies-v1', types: ['RUNS_ON', 'DEPENDS_ON'], maxDepth: 4, maxVisited: 200, maxAgeSeconds: 900 };
async function saveProcessingConfig(pool, owner, input, sources) {
    ownerRequired(owner);
    const allowed = ['enabled', 'captureEvidence', 'sourceIds', 'batchSize', 'maxAttempts', 'retrySeconds', 'expectedRevision', 'correlate', 'correlationPolicy', 'autoInvestigate'];
    if (!input || Object.keys(input).some(k => !allowed.includes(k)) || typeof input.enabled !== 'boolean' || (input.captureEvidence !== undefined && typeof input.captureEvidence !== 'boolean') || !Array.isArray(input.sourceIds) || input.sourceIds.length > 32 || new Set(input.sourceIds).size !== input.sourceIds.length || input.sourceIds.some(id => !sources.includes(id)))
        (0, topology_model_1.fail)(400, 'Choose up to 32 of your saved source revisions and an explicit enabled state.');
    for (const [key, min, max] of [['batchSize', 1, 10], ['maxAttempts', 1, 12], ['retrySeconds', 10, 3600], ['expectedRevision', 0, 2147483646]])
        if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)
            (0, topology_model_1.fail)(400, 'Invalid ' + key + '.');
    if (input.enabled && !input.sourceIds.length)
        (0, topology_model_1.fail)(400, 'Enable at least one source revision.');
    if (input.correlate !== undefined && typeof input.correlate !== 'boolean')
        (0, topology_model_1.fail)(400, 'Invalid correlate.');
    if (input.autoInvestigate !== undefined && typeof input.autoInvestigate !== 'boolean')
        (0, topology_model_1.fail)(400, 'Invalid autoInvestigate.');
    if (input.autoInvestigate === true && input.captureEvidence !== true)
        (0, topology_model_1.fail)(400, 'Automatic investigation starts from captured evidence; enable evidence capture too.');
    const correlationPolicy = input.correlationPolicy === undefined ? exports.DEFAULT_CORRELATION : input.correlationPolicy;
    if (!correlationPolicy || typeof correlationPolicy !== 'object' || Array.isArray(correlationPolicy) || Object.keys(correlationPolicy).some(k => !['id', 'types', 'maxDepth', 'maxVisited', 'maxAgeSeconds'].includes(k)) || typeof correlationPolicy.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(correlationPolicy.id) || !Array.isArray(correlationPolicy.types) || !correlationPolicy.types.length || correlationPolicy.types.some(t => !['RUNS_ON', 'DEPENDS_ON', 'ROUTES_TO', 'FORWARDS_TO'].includes(t)) || [['maxDepth', 1, 8], ['maxVisited', 1, 2000], ['maxAgeSeconds', 1, 86400]].some(([k, min, max]) => !Number.isInteger(correlationPolicy[k]) || correlationPolicy[k] < min || correlationPolicy[k] > max))
        (0, topology_model_1.fail)(400, 'Choose a bounded versioned dependency policy for automatic correlation.');
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const held = (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, 'worker'])).rows[0]?.record;
        if ((held?.revision || 0) !== input.expectedRevision)
            (0, topology_model_1.fail)(409, 'Processing configuration changed; refresh before saving.');
        if (input.enabled)
            for (const id of input.sourceIds)
                if (!(await c.query('SELECT id FROM operations_policy_bindings WHERE user_sub=$1 AND id=$2', [owner, id])).rows.length)
                    (0, topology_model_1.fail)(409, 'Publish a policy for each enabled source first.');
        const { expectedRevision, ...settings } = input, record = { ...settings, captureEvidence: input.captureEvidence === true, correlate: input.correlate === true, autoInvestigate: input.autoInvestigate === true, correlationPolicy, sourceIds: settings.sourceIds.slice().sort(), revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
        if (held)
            await c.query('UPDATE operations_processing_config SET revision=$3, record=$4 WHERE user_sub=$1 AND id=$2', [owner, 'worker', record.revision, JSON.stringify(record)]);
        else
            await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,$3,$4)', [owner, 'worker', record.revision, JSON.stringify(record)]);
        return record;
    });
}
async function claimProcessing(pool, owner, clock = Date.now) {
    ownerRequired(owner);
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const config = await processingConfig(c, owner);
        if (!config.enabled)
            return null;
        const now = stamp(clock), slots = config.sourceIds.map((_, i) => '$' + (i + 3)).join(',');
        const row = (await c.query("SELECT id, state, record FROM operations_processing WHERE user_sub=$1 AND state IN ('pending','retry','evaluating') AND ready_at <= $2 AND record->>'sourceId' IN (" + slots + ") ORDER BY ready_at, created_at, id LIMIT 1 FOR UPDATE", [owner, now, ...config.sourceIds])).rows[0];
        if (!row)
            return null;
        const previous = row.record.processing || {}, attempts = (previous.attempts || 0) + 1;
        const exhausted = attempts > config.maxAttempts, token = (0, node_crypto_1.randomUUID)(), leaseUntil = new Date(Date.parse(now) + 120000).toISOString();
        const processing = { attempts: exhausted ? previous.attempts : attempts, status: exhausted ? 'attention' : 'running', token: exhausted ? null : token, leaseUntil: exhausted ? null : leaseUntil, startedAt: now, configurationRevision: config.revision, ...(exhausted ? { lastError: 'Retry limit reached after an interrupted attempt.' } : {}) };
        await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, ready_at=$4, record=$5 WHERE user_sub=$1 AND id=$2', [owner, row.id, exhausted ? 'attention' : 'evaluating', leaseUntil, JSON.stringify({ ...row.record, processing })]);
        return exhausted ? { exhausted: true, id: row.id } : { id: row.id, token, config, leaseUntil };
    });
}
async function processingFence(c, owner, lease, work, now) {
    const held = work.record.processing;
    if (held?.token !== lease.token || Date.parse(held.leaseUntil) <= Date.parse(now))
        (0, topology_model_1.fail)(409, 'Processing lease expired or was replaced.');
    const config = await processingConfig(c, owner, true);
    if (!config.enabled || config.revision !== lease.config.revision || !config.sourceIds.includes(work.record.sourceId))
        (0, topology_model_1.fail)(409, 'Processing was stopped or its configuration changed.');
}
async function failedProcessing(pool, owner, lease, error, clock) {
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = (await c.query('SELECT state, record FROM operations_processing WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, lease.id])).rows[0];
        if (!row || row.state !== 'evaluating' || row.record.processing?.token !== lease.token)
            return false;
        const now = stamp(clock), held = row.record.processing;
        if (Date.parse(held.leaseUntil) <= Date.parse(now))
            return false;
        const permanent = [400, 404].includes(error.status), attention = permanent || held.attempts >= lease.config.maxAttempts;
        const retryAt = new Date(Date.parse(now) + Math.min(3600, lease.config.retrySeconds * 2 ** (held.attempts - 1)) * 1000).toISOString();
        const processing = { ...held, token: null, leaseUntil: null, status: attention ? 'attention' : 'retry', lastError: error.status ? String(error.message).slice(0, 240) : 'Detection storage or engine is unavailable.', failedAt: now, retryAt };
        await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, ready_at=$4, record=$5 WHERE user_sub=$1 AND id=$2', [owner, lease.id, processing.status, retryAt, JSON.stringify({ ...row.record, processing })]);
        return true;
    });
}
async function processPending(pool, engine, owner, clock = Date.now) {
    const config = await processingConfig(pool, owner), results = [], started = Date.now();
    if (!config.enabled)
        return { enabled: false, evaluated: 0, failed: 0, results };
    for (let i = 0; i < config.batchSize && Date.now() - started < 45000; i++) {
        const lease = await claimProcessing(pool, owner, clock);
        if (!lease)
            break;
        if (lease.exhausted) {
            results.push({ deliveryId: lease.id, error: 'Retry limit reached; review and retry explicitly.' });
            continue;
        }
        try {
            const decision = await (0, pipeline_1.evaluateDelivery)(pool, engine, owner, lease.id, () => stamp(clock), (c, work, now) => processingFence(c, owner, lease, work, now));
            results.push({ deliveryId: lease.id, decisionId: decision.id, outcome: decision.reduction.outcome });
        }
        catch (error) {
            await failedProcessing(pool, owner, lease, error, clock);
            results.push({ deliveryId: lease.id, error: error.status ? error.message : 'Processing is unavailable.' });
            if (!error.status || error.status >= 500)
                break;
        }
    }
    return { enabled: true, evaluated: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length, results };
}
async function retryProcessing(pool, owner, id, clock = Date.now) {
    ownerRequired(owner);
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
        (0, topology_model_1.fail)(400, 'Select a recorded delivery.');
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = (await c.query('SELECT state, record FROM operations_processing WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0];
        if (!row)
            (0, topology_model_1.fail)(404, 'Processing work is unavailable.');
        if (!['attention', 'retry', 'evidence-attention', 'evidence-retry'].includes(row.state))
            (0, topology_model_1.fail)(409, 'Only failed work can be retried; running and completed work are unchanged.');
        if (row.state.startsWith('evidence-')) {
            const now = stamp(clock), record = { ...row.record, captureProcessing: { status: 'pending', attempts: 0, retriedAt: now, previous: row.record.captureProcessing?.lastError || null } };
            await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, ready_at=$4, record=$5 WHERE user_sub=$1 AND id=$2', [owner, id, 'evidence-pending', now, JSON.stringify(record)]);
            return { deliveryId: id, state: 'evidence-pending' };
        }
        const now = stamp(clock), processing = { status: 'pending', attempts: 0, retriedAt: now, previous: row.record.processing?.lastError || null };
        await c.query('UPDATE operations_processing SET state=$3, revision=revision+1, ready_at=$4, record=$5 WHERE user_sub=$1 AND id=$2', [owner, id, 'pending', now, JSON.stringify({ ...row.record, processing })]);
        return { deliveryId: id, state: 'pending' };
    });
}
async function processingRecords(pool, owner) {
    const config = await processingConfig(pool, owner), rows = (await pool.query('SELECT id, state, ready_at, record FROM operations_processing WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 200', [owner])).rows;
    const jobs = rows.map(r => { const { token, ...processing } = r.record.processing || {}; return { id: r.id, sourceId: r.record.sourceId, state: r.state, readyAt: r.ready_at, processing, captureProcessing: r.record.captureProcessing || null }; });
    return { config, jobs, limit: 200, leaseSeconds: 120, scheduleName: 'operations-process-recorded-alerts' };
}
