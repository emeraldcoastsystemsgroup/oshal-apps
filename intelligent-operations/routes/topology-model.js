"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clean = exports.fail = exports.KINDS = exports.RELATIONS = void 0;
exports.instant = instant;
exports.identity = identity;
exports.scanDefinition = scanDefinition;
exports.reconstruct = reconstruct;
exports.correlate = correlate;
/** CHANGE LOG: node-pool | maintainer@emeraldcoastsystemsgroup.com | A managed node pool (EKS node group, GKE node pool, AKS agent pool) is an inventory kind (ADR0054). */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Scoped immutable asset identities, source-owned scan generations and bounded dependency correlation. */
// @ts-nocheck
const intake_1 = require("./intake");
const Contract = require('../ui/source-contract.js');
exports.RELATIONS = ['IN_REGION', 'IN_DATACENTER', 'IN_VPC', 'IN_SUBNET', 'IN_CLUSTER', 'IN_NAMESPACE', 'OWNED_BY', 'RUNS_ON', 'ROUTES_TO', 'SELECTS', 'FORWARDS_TO', 'REGISTERED_IN', 'IN_SECURITY_GROUP', 'ATTACHED_TO', 'ASSOCIATED_WITH', 'HAS_ATTACHMENT', 'PEERS_WITH', 'MEMBER_OF', 'DEPENDS_ON'];
exports.KINDS = ['site', 'datacenter', 'region', 'zone', 'host', 'virtual-machine', 'account', 'network', 'subnet', 'security-group', 'route-table', 'load-balancer', 'target-group', 'gateway', 'peering', 'endpoint', 'business-service', 'service-group', 'service-unit', 'cluster', 'node-pool', 'namespace', 'node', 'workload', 'replica-set', 'job', 'pod', 'container', 'service', 'ingress'];
const PROVIDERS = ['kubernetes', 'aws', 'azure', 'gcp', 'redfish', 'import'];
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
exports.fail = fail;
const clean = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f-\x9f]/.test(value);
exports.clean = clean;
function instant(value) { if (!Contract.validate(JSON.stringify({ ...Contract.example(), time: value })).ok)
    (0, exports.fail)(400, 'Use an explicit valid observation timestamp.'); return new Date(value).toISOString(); }
function identity(value) {
    if (!value || !PROVIDERS.includes(value.provider) || !exports.KINDS.includes(value.kind) || !(0, exports.clean)(value.scope, 512) || !(0, exports.clean)(value.nativeId, 512))
        (0, exports.fail)(400, 'Assets need a provider, native scope, supported kind and native ID.');
    const result = { provider: value.provider, scope: value.scope, kind: value.kind, nativeId: value.nativeId };
    return { ...result, id: (0, intake_1.hash)(['asset-v1', result]) };
}
function properties(value) {
    if (value === undefined)
        return {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 24)
        (0, exports.fail)(400, 'Use at most 24 explicit inventory properties.');
    const result = {};
    for (const [k, v] of Object.entries(value)) {
        if (!(0, exports.clean)(k, 80) || ['__proto__', 'prototype', 'constructor'].includes(k) || !((typeof v === 'string' && v.length <= 1024) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || v === null))
            (0, exports.fail)(400, 'Inventory properties must be bounded scalar values.');
        result[k] = v;
    }
    return result;
}
function scanDefinition(input, source) {
    if (!input || !(0, exports.clean)(input.scanId) || !(0, exports.clean)(input.collectionId) || !Array.isArray(input.assets) || input.assets.length > 256 || !Array.isArray(input.relationships) || input.relationships.length > 512 || typeof input.complete !== 'boolean')
        (0, exports.fail)(400, 'A bounded scan needs its ID, collection scope, completeness, assets and relationships.');
    if (Buffer.byteLength(JSON.stringify(input)) > 65536)
        (0, exports.fail)(413, 'Scan exceeds 64 KiB; narrow the configured collection scope.');
    const observedAt = instant(input.observedAt);
    if (Date.parse(observedAt) > Date.now() + 300000)
        (0, exports.fail)(400, 'Observation time is in the future.');
    const failures = input.failures || [];
    if (!Array.isArray(failures) || failures.length > 32 || failures.some(f => !f || !(0, exports.clean)(f.kind, 80) || !(0, exports.clean)(f.reason, 512)))
        (0, exports.fail)(400, 'Record bounded collection failures.');
    if (input.complete && failures.length)
        (0, exports.fail)(400, 'A scan with collection failures cannot be complete.');
    const seen = new Set();
    const assets = input.assets.map(a => { const ident = identity(a); if (seen.has(ident.id) || !(0, exports.clean)(a.name, 256) || !['healthy', 'degraded', 'unknown'].includes(a.health))
        (0, exports.fail)(400, 'Assets must have unique native identities, display names and explicit health or unknown.'); seen.add(ident.id); return { ...ident, name: a.name, health: a.health, properties: properties(a.properties) }; });
    const edgeIds = new Set();
    const relationships = input.relationships.map(e => {
        if (!e || !exports.RELATIONS.includes(e.type) || !(0, exports.clean)(e.evidence, 512))
            (0, exports.fail)(400, 'Relationships need a supported direction/type and an observation reason.');
        const from = identity(e.from), to = identity(e.to), id = (0, intake_1.hash)(['edge-v1', from.id, e.type, to.id]);
        if (edgeIds.has(id))
            (0, exports.fail)(400, 'Duplicate relationship in scan.');
        edgeIds.add(id);
        if (!seen.has(from.id))
            (0, exports.fail)(400, 'A relationship origin must be observed in this scan.');
        return { id, from: from.id, to: to.id, type: e.type, evidence: e.evidence, target: to, properties: properties(e.properties) };
    });
    assets.sort((a, b) => a.id.localeCompare(b.id));
    relationships.sort((a, b) => a.id.localeCompare(b.id));
    const body = { scanId: input.scanId, collectionId: input.collectionId, sourceId: source.id, source: source.source, environment: source.environment, observedAt, complete: input.complete, failures: failures.map(f => ({ kind: f.kind, reason: f.reason })), assets, relationships };
    return { ...body, id: (0, intake_1.hash)(['scan-v1', source.source, input.collectionId, input.scanId]), payloadHash: (0, intake_1.hash)(body) };
}
/** Rebuild event-time state from immutable generations. A partial scan may add/update but never retire. */
function reconstruct(scans, at) {
    at = instant(at);
    const ordered = scans.filter(s => s.observedAt <= at).sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
    const scopes = new Map();
    for (const scan of ordered) {
        const key = (0, intake_1.hash)([scan.source, scan.collectionId]);
        let state = scopes.get(key);
        if (!state) {
            state = { assets: new Map(), relationships: new Map(), last: scan };
            scopes.set(key, state);
        }
        if (scan.complete) {
            state.assets.clear();
            state.relationships.clear();
        }
        for (const a of scan.assets)
            state.assets.set(a.id, { ...a, observedAt: scan.observedAt, sourceId: scan.sourceId, scanId: scan.id });
        for (const e of scan.relationships)
            state.relationships.set(e.id, { ...e, observedAt: scan.observedAt, sourceId: scan.sourceId, scanId: scan.id });
        state.last = scan;
    }
    const assets = new Map(), edges = new Map(), collections = [];
    const merge = (map, row) => { const old = map.get(row.id); const observations = [...(old?.observations || []), { sourceId: row.sourceId, scanId: row.scanId, observedAt: row.observedAt }]; if (!old || old.observedAt <= row.observedAt)
        map.set(row.id, { ...row, observations });
    else
        old.observations = observations; };
    for (const s of scopes.values()) {
        for (const a of s.assets.values())
            merge(assets, a);
        for (const e of s.relationships.values())
            merge(edges, e);
        collections.push({ source: s.last.source, sourceId: s.last.sourceId, collectionId: s.last.collectionId, scanId: s.last.id, observedAt: s.last.observedAt, complete: s.last.complete, failures: s.last.failures });
    }
    if (assets.size > 2000 || edges.size > 5000)
        (0, exports.fail)(503, 'Topology exceeds its reconstruction budget; narrow the selected collection scope.');
    return { asOf: at, assets: [...assets.values()], relationships: [...edges.values()].map(e => ({ ...e, resolved: assets.has(e.from) && assets.has(e.to) })), collections };
}
/** Only observed affected assets connect incidents: an unaffected shared hub is not evidence of common failure. */
function correlate(graph, events, policy) {
    if (!policy || !(0, exports.clean)(policy.id) || !Array.isArray(policy.types) || !policy.types.length || policy.types.some(t => !['RUNS_ON', 'DEPENDS_ON', 'ROUTES_TO', 'FORWARDS_TO'].includes(t)) || !Number.isInteger(policy.maxDepth) || policy.maxDepth < 1 || policy.maxDepth > 8 || !Number.isInteger(policy.maxVisited) || policy.maxVisited < 1 || policy.maxVisited > 2000 || !Number.isInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds < 1 || policy.maxAgeSeconds > 86400)
        (0, exports.fail)(400, 'Choose a bounded versioned dependency policy.');
    if (!Array.isArray(events) || events.length > 200 || events.some(e => !e || !(0, exports.clean)(e.id) || !(0, exports.clean)(e.assetId, 64)) || new Set(events.map(e => e.id)).size !== events.length)
        (0, exports.fail)(400, 'Use at most 200 uniquely identified alert occurrences.');
    const now = Date.parse(graph.asOf), assets = new Map(graph.assets.map(a => [a.id, a])), affected = new Set(events.map(e => e.assetId)), adj = new Map();
    let traversed = 0;
    const fresh = row => row && now >= Date.parse(row.observedAt) && now - Date.parse(row.observedAt) <= policy.maxAgeSeconds * 1000;
    for (const e of graph.relationships) {
        if (!e.resolved || !policy.types.includes(e.type) || !fresh(e) || !fresh(assets.get(e.from)) || !fresh(assets.get(e.to)))
            continue;
        if (!adj.has(e.from))
            adj.set(e.from, []);
        adj.get(e.from).push(e);
    }
    const paths = [], problems = (graph.collections || []).filter(c => !c.complete).map(c => ({ collectionId: c.collectionId, reason: 'partial-collection' }));
    for (const seed of [...affected].sort()) {
        if (!assets.has(seed)) {
            problems.push({ assetId: seed, reason: 'asset-unresolved' });
            continue;
        }
        if (!fresh(assets.get(seed))) {
            problems.push({ assetId: seed, reason: 'asset-stale' });
            continue;
        }
        const visited = new Set([seed]), queue = [{ node: seed, path: [] }];
        while (queue.length) {
            const current = queue.shift();
            const next = adj.get(current.node) || [];
            if (graph.relationships.some(e => e.from === current.node && policy.types.includes(e.type) && (!e.resolved || !fresh(e) || !fresh(assets.get(e.to)))))
                problems.push({ assetId: current.node, reason: 'relationship-unavailable-or-stale' });
            if (current.path.length >= policy.maxDepth) {
                if (next.some(e => !visited.has(e.to)))
                    problems.push({ assetId: seed, reason: 'depth-budget' });
                continue;
            }
            for (const edge of next) {
                if (++traversed > policy.maxVisited) {
                    problems.push({ assetId: seed, reason: 'traversal-budget' });
                    queue.length = 0;
                    break;
                }
                if (visited.has(edge.to))
                    continue;
                visited.add(edge.to);
                const path = [...current.path, edge.id];
                if (affected.has(edge.to))
                    paths.push({ from: seed, to: edge.to, edges: path });
                queue.push({ node: edge.to, path });
            }
        }
    }
    // A truncated/unknown graph cannot justify partial merges. Same-asset identity remains a separately named fallback.
    const parent = new Map([...affected].map(id => [id, id]));
    const find = id => { while (parent.get(id) !== id)
        id = parent.get(id); return id; };
    if (!problems.length)
        for (const p of paths)
            parent.set(find(p.from), find(p.to));
    const groups = new Map();
    for (const e of events) {
        const key = find(e.assetId);
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(e.id);
    }
    return { policy, asOf: graph.asOf, status: problems.length ? 'degraded' : 'complete', method: problems.length ? 'exact-asset-fallback' : 'affected-dependency-paths', groups: [...groups.values()], paths: problems.length ? [] : paths, problems, traversed };
}
