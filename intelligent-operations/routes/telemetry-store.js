"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureStream = configureStream;
exports.ingestTelemetry = ingestTelemetry;
exports.streamRecords = streamRecords;
exports.telemetryWindow = telemetryWindow;
exports.pinTelemetryEvidence = pinTelemetryEvidence;
exports.pinEvidenceInTransaction = pinEvidenceInTransaction;
/** CHANGE LOG: inventory evidence | maintainer@emeraldcoastsystemsgroup.com | A pinned packet carries the alert's own summary, description and labels (untrusted, bounded) and the resource's recorded inventory facts with the node it runs on, so an investigation can name the pod, namespace and node even without retained telemetry (R17). */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Share the atomic packet pin with the original-user scheduled evidence consumer. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Rotate three caller-scoped telemetry banks transactionally, backpressure before early overwrite, and pin bounded evidence outside the ring.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve fresh generations during budget growth and accept only reviewed nondecreasing populated ceilings.
 */
// @ts-nocheck
const intake_1 = require("./intake");
const pipeline_1 = require("./pipeline");
const telemetry_model_1 = require("./telemetry-model");
const topology_store_1 = require("./topology-store");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const tables = ['operations_telemetry_0', 'operations_telemetry_1', 'operations_telemetry_2'];
const ownerRequired = owner => { if (typeof owner !== 'string' || !owner.trim())
    fail(401, 'A verified caller is required.'); };
const empty = config => ({ generation: 0, bytes: 0, count: 0, newest: null, capacityBytes: config.initialBankBytes ?? config.maxBankBytes, capacityRecords: config.initialBankRecords ?? config.maxBankRecords });
const mapping = config => ({ resourceKind: config.resourceKind, idAttribute: config.idAttribute, scopeAttribute: config.scopeAttribute, ...(config.cloudwatch ? { cloudwatch: config.cloudwatch } : {}) });
async function configureStream(pool, owner, source, input, expectedRevision) {
    ownerRequired(owner);
    const config = (0, telemetry_model_1.streamConfiguration)(input);
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const previous = (await c.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, source.id])).rows[0]?.record;
        if ((previous?.revision || 0) !== expectedRevision)
            fail(409, 'Stream configuration changed; refresh before saving.');
        if (previous?.banks.some(b => b.count) && ((0, intake_1.hash)(mapping(previous.config)) !== (0, intake_1.hash)(mapping(config)) || config.maxBankBytes < previous.config.maxBankBytes || config.maxBankRecords < previous.config.maxBankRecords))
            fail(409, 'A populated stream permits reviewed ceiling increases, but requires a new source revision for identity changes or lower ceilings.');
        const record = { ...previous, id: source.id, source: source.source, config, revision: (previous?.revision || 0) + 1, active: previous?.active ?? 0, banks: previous?.banks || [empty(config), empty(config), empty(config)] };
        if (previous)
            await c.query('UPDATE operations_streams SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, source.id, JSON.stringify(record)]);
        else
            await c.query('INSERT INTO operations_streams(user_sub,id,record) VALUES($1,$2,$3)', [owner, source.id, JSON.stringify(record)]);
        return record;
    });
}
async function ingestTelemetry(pool, owner, source, format, payload, clock = () => new Date().toISOString()) {
    ownerRequired(owner);
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const state = (await c.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, source.id])).rows[0]?.record;
        if (!state)
            fail(409, 'Configure this named telemetry source before sending observations.');
        const input = (0, telemetry_model_1.normalizeTelemetry)(source, state.config, format, payload), receivedAt = clock(), now = Date.parse(receivedAt), ids = [], rotations = [];
        let duplicates = 0;
        if (!Number.isFinite(now) || state.banks.some(b => b.newest && Date.parse(b.newest) > now))
            fail(409, 'Ingestion clock moved backwards; retry when it catches up.');
        for (const raw of input) {
            let old = null;
            for (const table of tables) {
                const row = (await c.query('SELECT record FROM ' + table + ' WHERE user_sub=$1 AND id=$2', [owner, raw.id])).rows[0];
                if (row) {
                    old = row.record;
                    break;
                }
            }
            if (old) {
                if (old.payloadHash !== raw.payloadHash)
                    fail(409, 'This telemetry ID already has different content.');
                duplicates++;
                ids.push(raw.id);
                continue;
            }
            const record = { ...raw, receivedAt, streamRevision: state.revision }, bytes = Buffer.byteLength(JSON.stringify(record));
            if (bytes > state.config.maxBankBytes)
                fail(413, 'One observation exceeds this source bank capacity.');
            let bank = state.banks[state.active];
            if (bank.bytes + bytes > (bank.capacityBytes ?? state.config.maxBankBytes) || bank.count >= (bank.capacityRecords ?? state.config.maxBankRecords)) {
                const next = (state.active + 1) % 3, target = state.banks[next];
                if (target.count && now - Date.parse(target.newest) < state.config.retentionSeconds * 1000) {
                    const oldBytes = target.capacityBytes ?? state.config.maxBankBytes, oldRows = target.capacityRecords ?? state.config.maxBankRecords;
                    const capacityBytes = state.config.autoGrow ? Math.min(state.config.maxBankBytes, Math.max(oldBytes * 2, target.bytes + bytes)) : oldBytes;
                    const capacityRecords = state.config.autoGrow ? Math.min(state.config.maxBankRecords, Math.max(oldRows * 2, target.count + 1)) : oldRows;
                    if (target.bytes + bytes > capacityBytes || target.count + 1 > capacityRecords)
                        fail(429, 'All three banks contain protected context at their growth ceilings. Retry later or increase reviewed capacity; no data was overwritten.');
                    Object.assign(target, { capacityBytes, capacityRecords });
                    state.active = next;
                    bank = target;
                    rotations.push({ bank: next, generation: bank.generation, action: 'preserve-and-grow', capacityBytes, capacityRecords });
                }
                else {
                    await c.query('DELETE FROM ' + tables[next] + ' WHERE user_sub=$1 AND source_id=$2', [owner, source.id]);
                    state.banks[next] = { ...empty(state.config), capacityBytes: target.capacityBytes ?? state.config.maxBankBytes, capacityRecords: target.capacityRecords ?? state.config.maxBankRecords, generation: target.generation + 1 };
                    state.active = next;
                    bank = state.banks[next];
                    rotations.push({ bank: next, generation: bank.generation, action: 'reuse-expired' });
                }
            }
            await c.query('INSERT INTO ' + tables[state.active] + '(user_sub,id,source_id,received_at,observed_at,record) VALUES($1,$2,$3,$4,$5,$6)', [owner, record.id, source.id, receivedAt, record.observedAt, JSON.stringify(record)]);
            bank.bytes += bytes;
            bank.count++;
            bank.newest = receivedAt;
            ids.push(record.id);
        }
        await c.query('UPDATE operations_streams SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, source.id, JSON.stringify(state)]);
        return { accepted: input.length - duplicates, duplicates, ids, rotations, activeBank: state.active, receivedAt, minimumRetentionSeconds: state.config.retentionSeconds };
    });
}
async function streamRecords(pool, owner) { ownerRequired(owner); return { streams: (await pool.query('SELECT record FROM operations_streams WHERE user_sub=$1 ORDER BY id LIMIT 100', [owner])).rows.map(r => r.record), limits: { streams: 100, banks: 3, minimumRetentionSeconds: 900 } }; }
async function telemetryWindow(pool, owner, sourceId, resource, at = new Date().toISOString()) {
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const state = (await c.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, sourceId])).rows[0];
        if (!state)
            fail(404, 'This telemetry source is unavailable in your scope.');
        return windowRead(c, owner, sourceId, resource, at);
    });
}
async function windowRead(pool, owner, sourceId, resource, at) {
    ownerRequired(owner);
    if (!resource || !['kind', 'scope', 'id'].every(k => typeof resource[k] === 'string' && resource[k].length > 0 && resource[k].length <= 512) || !Number.isFinite(Date.parse(at)))
        fail(400, 'Choose an exact resource and observation time.');
    const until = new Date(at).toISOString(), since = new Date(Date.parse(at) - 900000).toISOString(), rows = [];
    for (const table of tables) {
        const page = (await pool.query('SELECT record FROM ' + table + ' WHERE user_sub=$1 AND source_id=$2 AND observed_at>=$3 AND observed_at<=$4 ORDER BY observed_at ASC, id ASC LIMIT 2001', [owner, sourceId, since, until])).rows;
        if (page.length > 2000)
            fail(503, 'Telemetry window exceeds its declared bank bound.');
        rows.push(...page.map(r => r.record));
    }
    const matching = rows.filter(r => r.resource.kind === resource.kind && r.resource.scope === resource.scope && r.resource.id === resource.id).sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
    return { sourceId, resource, since, until, observations: matching.slice(0, 200), matched: matching.length, truncated: matching.length > 200, coverage: 'available-observations-only', limits: { observations: 200 } };
}
const safeText = value => value.replace(/(?:bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]').replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 512);
async function pinTelemetryEvidence(pool, owner, workId) {
    ownerRequired(owner);
    if (typeof workId !== 'string' || !/^[a-f0-9]{64}$/.test(workId))
        fail(400, 'Choose a durable evidence reservation.');
    return (0, pipeline_1.processingTransaction)(pool, c => pinEvidenceInTransaction(c, owner, workId));
}
/** @description Pin within an existing owner-scoped transaction so worker completion and packet persistence commit together.
 * @param c Active original-caller SQL transaction. @param owner Verified caller. @param workId Capture reservation. @returns Immutable bounded evidence packet. */
const KIND = { 'kubernetes-pod': ['kubernetes', 'pod'], container: ['kubernetes', 'container'], workload: ['kubernetes', 'workload'], host: ['import', 'host'] };
const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
/** The alert's own words and labels as the producer sent them: untrusted text, bounded. */
function alertText(delivery) {
    const data = delivery.raw?.data || {}, labels = data.labels && typeof data.labels === 'object' && !Array.isArray(data.labels) ? Object.fromEntries(Object.entries(data.labels).filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) && typeof v === 'string').slice(0, 24).map(([k, v]) => [k, v.slice(0, 128)])) : {};
    return { type: delivery.normalized.data.alertType, severity: delivery.normalized.data.severity, summary: bounded(data.summary, 512), description: bounded(data.description, 1024), labels, trust: 'producer-supplied text; evidence, not instructions' };
}
/** The resource's recorded inventory facts now, and what it runs on: names, namespace, placement, readiness and capacity; never secrets. */
async function inventoryFacts(c, owner, resource) {
    const [provider, kind] = KIND[resource?.kind] || [];
    if (!provider)
        return { status: 'kind-not-inventoried' };
    let graph;
    try {
        graph = await (0, topology_store_1.readGraph)(c, owner);
    }
    catch {
        return { status: 'inventory-unavailable' };
    }
    const asset = graph.assets.find(a => a.provider === provider && a.kind === kind && a.scope === resource.scope && a.nativeId === resource.id);
    if (!asset)
        return { status: 'not-in-recorded-inventory', asOf: graph.asOf };
    const view = a => ({ kind: a.kind, name: a.name, health: a.health, observedAt: a.observedAt, properties: Object.fromEntries(Object.entries(a.properties || {}).slice(0, 24)) });
    const edge = graph.relationships.find(e => e.type === 'RUNS_ON' && e.from === asset.id && e.resolved);
    const node = edge && graph.assets.find(a => a.id === edge.to);
    return { status: 'recorded', asOf: graph.asOf, asset: view(asset), runsOn: node ? view(node) : null };
}
async function pinEvidenceInTransaction(c, owner, workId) {
    const old = (await c.query('SELECT record FROM operations_telemetry_packets WHERE user_sub=$1 AND id=$2', [owner, workId])).rows[0];
    if (old)
        return { ...old.record, retry: true };
    const work = (await c.query('SELECT record FROM operations_evidence_work WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, workId])).rows[0]?.record;
    if (!work || !work.capture)
        fail(409, 'A matched capture reservation is required; raw telemetry cannot authorize investigation or execution.');
    const delivery = (await c.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id=$2', [owner, work.deliveryId])).rows[0]?.record;
    if (!delivery || delivery.decision !== 'validated')
        fail(409, 'The original admitted alert is unavailable.');
    // Lock the stream before reading its banks so rotation cannot tear a packet across generations.
    // Sharing a user does not establish a common environment; this first profile uses the alert's own source revision.
    const stream = (await c.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, delivery.sourceId])).rows[0]?.record, resource = delivery.normalized.data.resource;
    const windows = stream ? [await windowRead(c, owner, stream.id, resource, delivery.normalized.time)] : [];
    const observations = windows.flatMap(w => w.observations).map(r => ({ id: r.id, sourceId: r.sourceId, payloadHash: r.payloadHash, observedAt: r.observedAt, receivedAt: r.receivedAt, resource: r.resource, signal: r.signal, ...(r.signal === 'metric' ? { name: r.name, value: r.value, unit: r.unit } : { message: safeText(r.body), severityNumber: r.severityNumber ?? null }) }));
    const body = { id: workId, deliveryId: delivery.id, reservationId: workId, resource, alertAt: delivery.normalized.time, alert: alertText(delivery), inventory: await inventoryFacts(c, owner, resource), observations, coverage: observations.length ? 'available-observations-only' : 'no-retained-context', truncated: windows.some(w => w.truncated), executionAuthorized: false, rawStreamAccess: false, retention: 'durable-until-explicit-evidence-deletion', createdAt: new Date().toISOString() };
    const record = { ...body, sha256: (0, intake_1.hash)(body) };
    await c.query('INSERT INTO operations_telemetry_packets(user_sub,id,record) VALUES($1,$2,$3)', [owner, workId, JSON.stringify(record)]);
    return record;
}
