"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correlateAdmitted = correlateAdmitted;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Automatic post-reduction correlation: after a scheduled tick admits or escalates symptoms, correlate the admitted firing cohort of the policy window over the recorded temporal graph with the configured bounded policy; the cohort's newest alert time keys the record so an unchanged cohort is idempotent, and degraded graph evidence stays labeled by the correlation itself. */
// @ts-nocheck
const processing_worker_1 = require("./processing-worker");
const topology_store_1 = require("./topology-store");
const requireOwner = owner => { if (typeof owner !== 'string' || !owner.trim())
    throw Object.assign(Error('A verified caller is required.'), { status: 401 }); };
/** @description Admitted and escalated firing deliveries decided within the policy window, newest first, bounded to the correlation input limit. */
async function cohort(pool, owner, policy, now) {
    const since = new Date(now - policy.maxAgeSeconds * 1000).toISOString();
    const rows = (await pool.query("SELECT d.record AS delivery, f.record AS decision FROM operations_filter_decisions f JOIN operations_deliveries d ON d.user_sub=f.user_sub AND d.id=f.delivery_id WHERE f.user_sub=$1 AND f.created_at >= $2 AND f.record->'reduction'->>'outcome' IN ('admitted','escalated') ORDER BY f.created_at DESC LIMIT 200", [owner, since])).rows;
    const seen = new Set(), deliveries = [];
    for (const r of rows) {
        const d = r.delivery;
        if (seen.has(d.id) || d.decision !== 'validated' || d.normalized?.data?.status !== 'firing')
            continue;
        seen.add(d.id);
        deliveries.push(d);
    }
    return deliveries;
}
/** @description Correlate this tick's admitted cohort when the worker opted in; nothing is dispatched and a missing graph is reported by the correlation as degraded, never as success. */
async function correlateAdmitted(pool, owner, results, clock = Date.now) {
    requireOwner(owner);
    const config = await (0, processing_worker_1.processingConfig)(pool, owner);
    if (!config.enabled || !config.correlate)
        return { enabled: false };
    const fresh = (results || []).filter(r => ['admitted', 'escalated'].includes(r.outcome)).length;
    if (!fresh)
        return { enabled: true, correlated: false, reason: 'no newly admitted symptom in this tick' };
    const policy = config.correlationPolicy, deliveries = await cohort(pool, owner, policy, clock());
    if (!deliveries.length)
        return { enabled: true, correlated: false, reason: 'no admitted firing delivery inside the policy window' };
    const asOf = deliveries.map(d => d.normalized.time).sort().at(-1);
    try {
        const record = await (0, topology_store_1.correlateDeliveries)(pool, owner, { deliveryIds: deliveries.map(d => d.id), asOf, policy: { ...policy } });
        return { enabled: true, correlated: true, correlationId: record.id, retry: record.retry === true, deliveries: deliveries.length, groups: Array.isArray(record.groups) ? record.groups.length : null, degraded: record.degraded === true || record.fallback === true || null, trigger: 'scheduled-tick' };
    }
    catch (error) {
        return { enabled: true, correlated: false, error: error.status ? String(error.message).slice(0, 240) : 'Topology storage is unavailable.' };
    }
}
