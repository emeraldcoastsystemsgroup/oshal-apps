/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.9.6 (R14): guard kubernetes-node alert schema, intake, Alertmanager ingest, OTLP telemetry & evidence inventory facts, temporal graph correlation (including RUNS_ON pod/container/node grouping, isolation of unaffected nodes, historical as-of fidelity, and automatic tick correlation), sandbox replay, and Systems/Explorer UI projection.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { fixture, loadExperience, root } = require('./fixtures/intake.cjs');
const Contract = require('../ui/source-contract.js');
const Mapping = require('../ui/adapter-mapping.js');
const { admit } = require('../routes/intake.js');
const { alertEvent, saveIngestMapping, ingestAlertmanager } = require('../routes/ingest.js');
const { streamConfiguration, normalizeTelemetry } = require('../routes/telemetry-model.js');
const { configureStream, ingestTelemetry, telemetryWindow, pinTelemetryEvidence } = require('../routes/telemetry-store.js');
const { identity } = require('../routes/topology-model.js');
const { saveScan, correlateDeliveries } = require('../routes/topology-store.js');
const { publishPolicy, evaluateDelivery } = require('../routes/pipeline.js');
const { saveProcessingConfig } = require('../routes/processing-worker.js');
const { correlateAdmitted } = require('../routes/correlation-tick.js');
const { batchReplay } = require('../routes/replay-sandbox.js');
const { systemInventory } = require('../experience/explorer.js');
const ResourceTree = require('../experience/resource-tree.js');

const SCOPE = 'cluster-uid-r14';
const T1 = '2026-10-23T08:00:00.000Z';
const T2 = '2026-10-23T08:05:00.000Z';
const POLICY = { id: 'affected-paths-v1', types: ['RUNS_ON'], maxDepth: 4, maxVisited: 200, maxAgeSeconds: 900 };

const k8sAsset = (kind, nativeId, name = nativeId, extra = {}) => ({
  provider: 'kubernetes', scope: SCOPE, kind, nativeId, name, health: 'healthy', ...extra,
});

const k8sEdge = (from, to, type = 'RUNS_ON') => ({ from, to, type, evidence: 'live pod spec.nodeName resolved to a live node UID' });

function makeEvent(sourceUri, env, kind, nativeId, alertType, time = T1, status = 'firing') {
  const event = Contract.example();
  event.id = randomUUID();
  event.source = sourceUri;
  event.time = time;
  Object.assign(event.data, {
    environment: env, alertType, severity: 'critical', status,
    resource: { kind, scope: SCOPE, id: nativeId },
  });
  return event;
}

function twoNodeScan(scanId, observedAt, nodeAUid = 'node-uid-a') {
  const nodeA = k8sAsset('node', nodeAUid, 'worker-a', { health: 'degraded', properties: { pressure: 'MemoryPressure', capacityCpu: '8', allocatableCpu: '7800m' } });
  const nodeB = k8sAsset('node', 'node-uid-b', 'worker-b', { health: 'healthy', properties: { capacityCpu: '8', allocatableCpu: '7800m' } });
  const podA = k8sAsset('pod', 'pod-uid-a', 'checkout-a', { health: 'degraded', properties: { namespace: 'demo', nodeName: 'worker-a' } });
  const podB = k8sAsset('pod', 'pod-uid-b', 'checkout-b', { health: 'healthy', properties: { namespace: 'demo', nodeName: 'worker-b' } });
  const containerA = k8sAsset('container', 'containerd://ctr-a', 'checkout', { health: 'degraded', properties: { namespace: 'demo' } });
  return {
    scanId, collectionId: 'live:' + SCOPE + '/demo', observedAt, complete: true,
    assets: [nodeA, nodeB, podA, podB, containerA],
    relationships: [k8sEdge(podA, nodeA), k8sEdge(podB, nodeB), k8sEdge(containerA, podA)],
    refs: { nodeA, nodeB, podA, podB, containerA },
  };
}

test('schema, source contract and adapter mapping accept kubernetes-node and still reject invalid kinds', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'contracts/operations-alert-v1.schema.json'), 'utf8'));
  const enumKinds = schema.properties.data.properties.resource.properties.kind.enum;
  assert.ok(enumKinds.includes('kubernetes-node'));
  assert.ok(enumKinds.includes('kubernetes-pod'));
  assert.ok(Contract.KINDS.includes('kubernetes-node'));

  const valid = makeEvent(Contract.example().source, 'local-lab', 'kubernetes-node', 'node-uid-1', 'NodeMemoryPressure');
  const checked = Contract.validate(JSON.stringify(valid));
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.resource, { kind: 'kubernetes-node', scope: SCOPE, id: 'node-uid-1' });
  assert.equal(checked.symptomIdentity[2], 'kubernetes-node');
  assert.equal(Mapping.normalize(JSON.stringify(valid)).ok, true);

  for (const badKind of ['bogus-kind', 'node', 'k8s-node', '']) {
    const bad = structuredClone(valid);
    bad.data.resource.kind = badKind;
    assert.equal(Contract.validate(JSON.stringify(bad)).ok, false, badKind);
    assert.equal(Mapping.normalize(JSON.stringify(bad)).ok, false, badKind);
  }
});

test('Alertmanager ingest mapping accepts kubernetes-node, deduplicates retries and rejects invalid kinds', async () => {
  const f = await fixture();
  try {
    const pool = f.caller('alice');
    const source = loadExperience().sourceDefinition({ name: 'Node Alertmanager', environment: 'ops-lab', source: 'urn:operations:source:node-am' });
    for (const badKind of ['bogus-kind', 'node']) {
      await assert.rejects(saveIngestMapping(pool, 'alice', { sourceId: source.id, resourceKind: badKind, idLabel: 'node_uid', scope: SCOPE }, [source]), e => e.status === 400);
    }
    const saved = await saveIngestMapping(pool, 'alice', { sourceId: source.id, resourceKind: 'kubernetes-node', idLabel: 'node_uid', scope: SCOPE }, [source]);
    assert.equal(saved.resourceKind, 'kubernetes-node');

    const nodeAlert = (status, desc = 'Memory pressure on worker-a') => ({
      status, fingerprint: 'a1b2c3d4', startsAt: T1,
      endsAt: status === 'resolved' ? T2 : '0001-01-01T00:00:00Z',
      labels: { alertname: 'NodeMemoryPressure', node_uid: 'node-uid-a', severity: 'critical' },
      annotations: { summary: 'Worker node memory pressure', description: desc },
    });
    const ev = alertEvent(saved, nodeAlert('firing'));
    assert.deepEqual(ev.data.resource, { kind: 'kubernetes-node', scope: SCOPE, id: 'node-uid-a' });

    const first = await ingestAlertmanager(pool, 'alice', [source], source.id, {
      alerts: [nodeAlert('firing'), { ...nodeAlert('firing'), fingerprint: 'missing1', labels: { alertname: 'NodeNotReady', severity: 'critical' } }],
    });
    assert.equal(first.admitted, 1);
    assert.equal(first.quarantined, 1);

    const retry = await ingestAlertmanager(pool, 'alice', [source], source.id, { alerts: [nodeAlert('firing', 'Memory pressure still active')] });
    assert.equal(retry.results[0].retry, true);
    assert.equal(retry.admitted, 0);

    const resolved = await ingestAlertmanager(pool, 'alice', [source], source.id, { alerts: [nodeAlert('resolved')] });
    assert.equal(resolved.admitted, 1);
  } finally {
    await f.close();
  }
});

test('telemetry stream accepts kubernetes-node and evidence packets resolve recorded node inventory facts', async () => {
  const f = await fixture();
  try {
    const owner = 'node-telem-' + randomUUID();
    const pool = f.caller(owner);
    const source = loadExperience().sourceDefinition({ name: 'Node OTLP', environment: 'ops-lab', source: 'urn:triagenorth:test:' + randomUUID() });
    const cfg = { resourceKind: 'kubernetes-node', idAttribute: 'k8s.node.uid', scopeAttribute: 'k8s.cluster.uid' };
    assert.equal(streamConfiguration(cfg).resourceKind, 'kubernetes-node');
    assert.throws(() => streamConfiguration({ ...cfg, resourceKind: 'bogus-kind' }), e => e.status === 400);
    await configureStream(pool, owner, source, cfg, 0);

    const scan = twoNodeScan('scan-telem-1', T1);
    const { refs, ...scanInput } = scan;
    await saveScan(pool, owner, source, scanInput);

    const nano = String(BigInt(Date.parse(T1)) * 1000000n);
    const metrics = {
      resourceMetrics: [{
        resource: { attributes: [{ key: 'k8s.node.uid', value: { stringValue: 'node-uid-a' } }, { key: 'k8s.cluster.uid', value: { stringValue: SCOPE } }] },
        scopeMetrics: [{ metrics: [{ name: 'k8s.node.cpu.utilization', unit: '1', gauge: { dataPoints: [{ timeUnixNano: nano, asDouble: 0.96 }] } }] }],
      }],
    };
    const norm = normalizeTelemetry(source, cfg, 'otlp-metrics', metrics);
    assert.deepEqual(norm[0].resource, { kind: 'kubernetes-node', id: 'node-uid-a', scope: SCOPE });
    assert.equal((await ingestTelemetry(pool, owner, source, 'otlp-metrics', metrics, () => T1)).accepted, 1);

    const win = await telemetryWindow(pool, owner, source.id, { kind: 'kubernetes-node', scope: SCOPE, id: 'node-uid-a' }, T1);
    assert.equal(win.matched, 1);
    const delivery = (await admit(pool, owner, source, makeEvent(source.source, 'ops-lab', 'kubernetes-node', 'node-uid-a', 'NodeCpuPressure', T1))).record;
    const workId = 'c'.repeat(64);
    await pool.query('INSERT INTO operations_evidence_work(user_sub,id,state,record,created_at) VALUES($1,$2,$3,$4,$5)', [owner, workId, 'pending', JSON.stringify({ id: workId, deliveryId: delivery.id, capture: true, state: 'pending' }), T1]);

    const packet = await pinTelemetryEvidence(pool, owner, workId);
    assert.equal(packet.inventory.status, 'recorded');
    assert.equal(packet.inventory.asset.kind, 'node');
    assert.equal(packet.inventory.asset.name, 'worker-a');
    assert.equal(packet.inventory.asset.properties.pressure, 'MemoryPressure');
    assert.equal(packet.inventory.runsOn, null);
    assert.equal(packet.observations.length, 1);
  } finally {
    await f.close();
  }
});

test('temporal graph correlation resolves kubernetes-node alerts, groups affected node+pod/container and isolates unaffected nodes', async () => {
  const f = await fixture();
  try {
    const pool = f.caller('alice');
    const source = loadExperience().sourceDefinition({ name: 'K8s Graph', environment: 'ops-lab', source: 'urn:operations:source:k8s-graph' });
    const { refs: r1, ...scan1Body } = twoNodeScan('scan-1', T1, 'node-uid-a');
    await saveScan(pool, 'alice', source, scan1Body);

    const dNodeA = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'kubernetes-node', 'node-uid-a', 'NodeMemoryPressure', T1))).record.id;
    const dPodA = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'kubernetes-pod', 'pod-uid-a', 'PodEvicted', T1))).record.id;
    const dPodB = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'kubernetes-pod', 'pod-uid-b', 'PodSlow', T1))).record.id;
    const dCtrA = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'container', 'containerd://ctr-a', 'OOMKilled', T1))).record.id;

    const solo = await correlateDeliveries(pool, 'alice', { deliveryIds: [dNodeA], asOf: T1, policy: POLICY });
    assert.equal(solo.status, 'complete');
    assert.equal(solo.method, 'affected-dependency-paths');
    assert.equal(solo.events[0].assetId, identity(r1.nodeA).id);

    const mixed = await correlateDeliveries(pool, 'alice', { deliveryIds: [dNodeA, dPodA, dPodB], asOf: T1, policy: POLICY });
    assert.equal(mixed.status, 'complete');
    assert.equal(mixed.method, 'affected-dependency-paths');
    assert.equal(mixed.groups.length, 2);
    assert.deepEqual(mixed.groups.map(g => g.length).sort(), [1, 2]);
    assert.ok(mixed.groups.some(g => g.includes(dNodeA) && g.includes(dPodA) && !g.includes(dPodB)));
    assert.equal(mixed.paths.length, 1);

    const reversed = await correlateDeliveries(pool, 'alice', { deliveryIds: [dPodB, dPodA, dNodeA], asOf: T1, policy: POLICY });
    assert.equal(reversed.id, mixed.id);
    assert.equal(reversed.retry, true);

    const multiHop = await correlateDeliveries(pool, 'alice', { deliveryIds: [dCtrA, dNodeA], asOf: T1, policy: POLICY });
    assert.equal(multiHop.status, 'complete');
    assert.equal(multiHop.groups.length, 1);
    assert.equal(multiHop.paths.length, 1);
    assert.equal(multiHop.paths[0].edges.length, 2);
  } finally {
    await f.close();
  }
});

test('temporal graph correlation enforces strict kind boundaries and preserves historical as-of fidelity after node replacement', async () => {
  const f = await fixture();
  try {
    const pool = f.caller('alice');
    const source = loadExperience().sourceDefinition({ name: 'K8s History', environment: 'ops-lab', source: 'urn:operations:source:k8s-history' });
    const { refs: _r1, ...scan1Body } = twoNodeScan('scan-h1', T1, 'node-uid-a');
    await saveScan(pool, 'alice', source, scan1Body);

    const dNodeA = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'kubernetes-node', 'node-uid-a', 'NodeMemoryPressure', T1))).record.id;
    const dPodA = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'kubernetes-pod', 'pod-uid-a', 'PodEvicted', T1))).record.id;
    const dWrongKind = (await admit(pool, 'alice', source, makeEvent(source.source, 'ops-lab', 'kubernetes-node', 'pod-uid-a', 'KindMismatch', T1))).record.id;

    const mismatch = await correlateDeliveries(pool, 'alice', { deliveryIds: [dWrongKind], asOf: T1, policy: POLICY });
    assert.equal(mismatch.status, 'degraded');
    assert.ok(mismatch.events[0].assetId.startsWith('unresolved-'));

    const { refs: _r2, ...scan2Body } = twoNodeScan('scan-h2', T2, 'node-uid-a-v2');
    await saveScan(pool, 'alice', source, scan2Body);
    const nowDegraded = await correlateDeliveries(pool, 'alice', { deliveryIds: [dNodeA, dPodA], asOf: T2, policy: POLICY });
    assert.equal(nowDegraded.status, 'degraded');
    assert.equal(nowDegraded.method, 'exact-asset-fallback');
    const historical = await correlateDeliveries(pool, 'alice', { deliveryIds: [dNodeA, dPodA], asOf: T1, policy: POLICY });
    assert.equal(historical.status, 'complete');
    assert.equal(historical.groups.length, 1);
  } finally {
    await f.close();
  }
});

test('automatic tick correlation and isolated sandbox batch replay resolve kubernetes-node alerts cleanly', async () => {
  const f = await fixture();
  try {
    const owner = 'tick-' + randomUUID();
    const pool = f.caller(owner);
    const source = loadExperience().sourceDefinition({ name: 'Tick Node', environment: 'ops-lab', source: 'urn:triagenorth:test:' + randomUUID() });
    const { refs, ...scanBody } = twoNodeScan('scan-tick', T1);
    await saveScan(pool, owner, source, scanBody);

    let ruleId = null;
    const engine = async (op, _o, input) => {
      if (op === 'publish') return { revision: input.revision, count: input.rules.length, sealed: true };
      return { revision: input.revision, matches: [ruleId], total: 1, complete: true };
    };
    const published = await publishPolicy(pool, engine, owner, source, { name: 'Node+Pod', window: { mode: 'sliding', seconds: 900 }, rules: [{ name: 'Firing', enabled: true, capture: false, query: { term: { status: 'firing' } } }] }, 0);
    ruleId = published.policy.rules[0].id;

    const evNode = makeEvent(source.source, 'ops-lab', 'kubernetes-node', 'node-uid-a', 'NodeCpuPressure', T1);
    const evPod = makeEvent(source.source, 'ops-lab', 'kubernetes-pod', 'pod-uid-a', 'PodThrottled', T1);
    const d1 = (await admit(pool, owner, source, evNode)).record;
    const d2 = (await admit(pool, owner, source, evPod)).record;
    const r1 = await evaluateDelivery(pool, engine, owner, d1.id);
    const r2 = await evaluateDelivery(pool, engine, owner, d2.id);

    await saveProcessingConfig(pool, owner, { enabled: true, sourceIds: [source.id], batchSize: 10, maxAttempts: 3, retrySeconds: 10, correlate: true, expectedRevision: 0 }, [source.id]);
    const tick = await correlateAdmitted(pool, owner, [{ deliveryId: r1.deliveryId, outcome: r1.reduction.outcome }, { deliveryId: r2.deliveryId, outcome: r2.reduction.outcome }], () => Date.parse(T1) + 5000);
    assert.equal(tick.correlated, true);
    assert.equal(tick.degraded, false);
    assert.equal(tick.groups, 1);

    const replays = new Map();
    const ctx = { pool, store: { query: async n => n === 'sources' ? [source] : [...replays.values()], put: async (_n, id, rec) => replays.set(id, rec) } };
    const sandbox = await batchReplay(ctx, engine, owner, { sourceId: source.id, format: 'cloudevents', batch: [evNode, evPod] });
    assert.equal(sandbox.correlation.groups.length, 1);
    assert.ok(sandbox.correlation.events.some(e => e.assetId === identity(refs.nodeA).id));
    assert.ok(sandbox.correlation.events.some(e => e.assetId === identity(refs.podA).id));
  } finally {
    await f.close();
  }
});

test('Systems Explorer and resource tree attach kubernetes-node alerts to the matching node asset only', () => {
  const nodeAsset = { id: 'id-node-a', provider: 'kubernetes', scope: SCOPE, kind: 'node', nativeId: 'node-uid-a', name: 'worker-a', health: 'degraded', observedAt: T1, properties: { pressure: 'MemoryPressure', capacityCpu: '8', allocatableCpu: '7800m' } };
  const podSameId = { id: 'id-pod-collision', provider: 'kubernetes', scope: SCOPE, kind: 'pod', nativeId: 'node-uid-a', name: 'pod-same-id', health: 'healthy', observedAt: T1, properties: { namespace: 'demo' } };
  const graph = { asOf: T1, assets: [nodeAsset, podSameId], relationships: [{ from: 'id-pod-collision', to: 'id-node-a', type: 'RUNS_ON', evidence: 'live' }], collections: [{ complete: true }] };

  const nodeRec = { id: 'ev-node-1', decision: 'validated', normalized: makeEvent('urn:operations:source:lab', 'ops-lab', 'kubernetes-node', 'node-uid-a', 'NodeMemoryPressure', T1) };
  const quarantined = { id: 'ev-node-bad', decision: 'quarantined', normalized: makeEvent('urn:operations:source:lab', 'ops-lab', 'kubernetes-node', 'node-uid-a', 'NodeBad', T1) };
  const model = systemInventory(graph, [nodeRec, quarantined]);

  const nodeRow = model.rows.find(r => r.id === 'id-node-a');
  const podRow = model.rows.find(r => r.id === 'id-pod-collision');
  assert.deepEqual(nodeRow.events.map(e => e.id), ['ev-node-1']);
  assert.equal(podRow.events.length, 0);
  assert.ok(model.types.includes('node'));

  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.listeners = {}; }
    get childElementCount() { return this.children.length; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = [...items]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  const all = el => [el, ...el.children.flatMap(all)];
  const prior = global.document;
  global.document = { createElement: tag => new El(tag) };
  try {
    const panel = new El('section');
    let inspected = null;
    ResourceTree.detail(panel, nodeRow, { onEvent: e => { inspected = e; } });
    const buttons = all(panel).filter(n => n.tag === 'button');
    const alertBtn = buttons.find(b => b.textContent.startsWith('NodeMemoryPressure'));
    assert.ok(alertBtn, 'node detail renders the related kubernetes-node alert button');
    alertBtn.listeners.click();
    assert.equal(inspected, nodeRec);
  } finally {
    global.document = prior;
  }
});
