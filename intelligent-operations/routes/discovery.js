"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveScan = liveScan;
exports.discoveryConfig = discoveryConfig;
exports.saveDiscoveryConfig = saveDiscoveryConfig;
exports.runDiscovery = runDiscovery;
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Record each pod's container names in the live scan (identical to the panel builder). */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | A forced read: when the tick admits alerts that need evidence, discovery reads the cluster at once, so the evidence packet can name the alerting pod even when it appeared since the last interval (R17). */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Scheduled live discovery (R15, kernel ADR-196): with the person's opt-in, the processing tick reads one cluster's nodes and one namespace's pods and deployments through the person's own Kubernetes connection (kernel `connector.read`, read path only) at most once per chosen interval, and saves them as a live scan of a recorded cluster exactly as the Systems panel's Read and Save do. The attempt is claimed before the read, so concurrent ticks read once; a refused or failed read is recorded for the person and waits for the next interval. Nothing is executed. */
// @ts-nocheck
const pipeline_1 = require("./pipeline");
const topology_store_1 = require("./topology-store");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/, NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/, SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
// The kernel answers a refused, invalid or ungranted read before anything reaches the cluster.
const REFUSED = /^(refused|invalid): |is not linked for this package/;
const ID = 'discovery', defaults = { enabled: false, account: 'primary', sourceId: null, scope: null, namespace: null, intervalMinutes: 15, revision: 0 };
const ownerRequired = owner => { if (typeof owner !== 'string' || !owner)
    fail(401, 'A verified caller is required.'); };
/** @description The browser panel's scan builder (experience/live-cluster.js `scan`), kept identical; tests/discovery.test.cjs compares the two. */
function liveScan(scope, namespace, nodes, pods, deployments, observedAt, truncated = false) {
    const asset = (kind, v, health, properties) => ({ provider: 'kubernetes', scope, kind, nativeId: v.uid, name: v.name, health, properties: Object.fromEntries(Object.entries(properties).filter(([, x]) => x !== null && x !== undefined)) });
    const health = ready => ready === 'True' ? 'healthy' : ready === 'False' ? 'degraded' : 'unknown', rows = [];
    for (const n of nodes)
        rows.push({ a: asset('node', n, n.pressure?.length || n.ready === 'False' ? 'degraded' : health(n.ready), { allocatableCpu: n.allocatable?.cpu, allocatableMemory: n.allocatable?.memory, allocatablePods: n.allocatable?.pods, capacityCpu: n.capacity?.cpu, capacityMemory: n.capacity?.memory, capacityPods: n.capacity?.pods, pressure: (n.pressure || []).join(',') || null, roles: (n.roles || []).join(',') || null, kubeletVersion: n.kubelet, osImage: n.os, containerRuntime: n.runtime, architecture: n.architecture, internalIp: n.internalIp, providerId: n.providerId, unschedulable: n.unschedulable === true }) });
    for (const d of deployments)
        rows.push({ a: asset('workload', d, d.available_condition === 'True' ? 'healthy' : d.available_condition === 'False' ? 'degraded' : 'unknown', { namespace, kubernetesKind: 'Deployment', replicas: d.replicas, readyReplicas: d.ready, availableReplicas: d.available }) });
    const byName = new Map(nodes.map(n => [n.name, n]));
    for (const p of pods) {
        const n = byName.get(p.node);
        rows.push({ a: asset('pod', p, health(p.ready), { namespace, phase: p.phase, readyStatus: p.ready, nodeName: p.node, restarts: p.restarts, ownerKind: p.owner, ownerName: p.ownerName, containers: Array.isArray(p.containers) ? p.containers.map(c => c && c.name).filter(n => typeof n === 'string').slice(0, 16).join(',') || null : null }), e: n ? { from: { provider: 'kubernetes', scope, kind: 'pod', nativeId: p.uid }, to: { provider: 'kubernetes', scope, kind: 'node', nativeId: n.uid }, type: 'RUNS_ON', evidence: 'live pod spec.nodeName resolved to a live node UID' } : null });
    }
    const out = { scanId: 'live-' + String(observedAt).replace(/[^0-9]/g, '').slice(0, 17) + '-' + namespace, collectionId: 'live:' + scope + '/' + namespace, observedAt, complete: true, failures: [], assets: [], relationships: [] };
    let size = JSON.stringify(out).length + 512, cut = false;
    for (const r of rows) {
        const add = JSON.stringify(r.a).length + (r.e ? JSON.stringify(r.e).length : 0) + 2;
        if (out.assets.length >= 256 || size + add > 60000) {
            cut = true;
            break;
        }
        out.assets.push(r.a);
        if (r.e)
            out.relationships.push(r.e);
        size += add;
    }
    if (cut)
        out.failures.push({ kind: 'scan-budget', reason: 'The live read had more objects than one 64 KiB scan holds; ' + out.assets.length + ' of ' + rows.length + ' were saved.' });
    if (truncated)
        out.failures.push({ kind: 'list-limit', reason: 'A live list returned its first 500 items only.' });
    out.complete = !out.failures.length;
    return out;
}
async function discoveryConfig(pool, owner) {
    ownerRequired(owner);
    return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, ID])).rows[0]?.record || { ...defaults };
}
/** @description Save the person's discovery choice: one account, recorded cluster, namespace and source, every 5 to 1440 minutes. */
async function saveDiscoveryConfig(pool, owner, input, sources) {
    ownerRequired(owner);
    const allowed = ['enabled', 'account', 'sourceId', 'scope', 'namespace', 'intervalMinutes', 'expectedRevision'];
    if (!input || typeof input !== 'object' || Object.keys(input).some(k => !allowed.includes(k)) || typeof input.enabled !== 'boolean')
        fail(400, 'Choose an explicit enabled state.');
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646)
        fail(400, 'Invalid expectedRevision.');
    if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 1440)
        fail(400, 'Choose an interval from 5 to 1440 minutes.');
    if (typeof input.account !== 'string' || !ACCOUNT.test(input.account))
        fail(400, 'Choose one of your Kubernetes accounts.');
    if (typeof input.namespace !== 'string' || !NAMESPACE.test(input.namespace))
        fail(400, 'Name one namespace (a DNS label).');
    if (typeof input.scope !== 'string' || !SCOPE.test(input.scope))
        fail(400, 'Choose a recorded cluster.');
    if (!sources.includes(input.sourceId))
        fail(400, 'Choose one of your saved source revisions.');
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const held = (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, ID])).rows[0]?.record;
        if ((held?.revision || 0) !== input.expectedRevision)
            fail(409, 'Discovery settings changed; refresh before saving.');
        const { expectedRevision, ...settings } = input, record = { ...settings, revision: expectedRevision + 1, updatedAt: new Date().toISOString(), lastAttemptAt: null, lastResult: held?.lastResult || null };
        if (held)
            await c.query('UPDATE operations_processing_config SET revision=$3, record=$4 WHERE user_sub=$1 AND id=$2', [owner, ID, record.revision, JSON.stringify(record)]);
        else
            await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,$3,$4)', [owner, ID, record.revision, JSON.stringify(record)]);
        return record;
    });
}
const due = (config, now) => !config.lastAttemptAt || Date.parse(config.lastAttemptAt) + config.intervalMinutes * 60000 <= now;
async function update(pool, owner, revision, patch, when) {
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const held = (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, ID])).rows[0]?.record;
        if (!held?.enabled || held.revision !== revision || (when && !when(held)))
            return null;
        const record = { ...held, ...patch };
        await c.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, ID, JSON.stringify(record)]);
        return record;
    });
}
/** @description On the tick: when due (or forced, when new alerts need evidence about the cluster now), claim the attempt, read through `connector.read`, save the live scan and record the outcome. */
async function runDiscovery(ctx, owner, sources, clock = Date.now, force = false) {
    const config = await discoveryConfig(ctx.pool, owner), now = clock();
    if (!config.enabled)
        return { enabled: false };
    if (typeof ctx.intent !== 'function')
        return { enabled: true, available: false, reason: 'The kernel connector read port is unavailable; read the cluster from Systems.' };
    if (!force && !due(config, now))
        return { enabled: true, due: false, nextAt: new Date(Date.parse(config.lastAttemptAt) + config.intervalMinutes * 60000).toISOString() };
    const attemptAt = new Date(now).toISOString();
    if (!await update(ctx.pool, owner, config.revision, { lastAttemptAt: attemptAt }, held => force || due(held, now)))
        return { enabled: true, due: false, reason: 'Another tick is reading this cluster.' };
    let result;
    const source = sources.find(s => s.id === config.sourceId);
    if (!source)
        result = { state: 'failed', error: 'The chosen source revision is no longer saved; choose another in Systems.' };
    else
        try {
            const read = (operation, input) => ctx.intent('connector.read', { connector: 'kubernetes', operation, account: config.account, input });
            const nodes = await read('kubernetes-list-nodes', {}), pods = await read('kubernetes-list-pods', { namespace: config.namespace }), deployments = await read('kubernetes-list-deployments', { namespace: config.namespace });
            const scan = liveScan(config.scope, config.namespace, nodes.items || [], pods.items || [], deployments.items || [], nodes.observedAt, [nodes, pods, deployments].some(r => r.truncated));
            const saved = await (0, topology_store_1.saveScan)(ctx.pool, owner, source, scan);
            result = { state: 'saved', observedAt: nodes.observedAt, assets: scan.assets.length, complete: scan.complete, failures: scan.failures.map(f => f.reason), retry: saved.retry === true };
        }
        catch (error) {
            const message = String(error?.message || error).slice(0, 240);
            result = { state: REFUSED.test(message) ? 'refused' : 'failed', error: message };
        }
    await update(ctx.pool, owner, config.revision, { lastResult: { ...result, attemptAt } });
    return { enabled: true, due: true, ...result };
}
