/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (design-studio--design-studio): a product page showed four primary buttons at once, offered 'Close the phase' on phases with no engine, and printed a raw route ('/api/embodied/physics/reports: the physics engine is unavailable') in a card. The shipped stages and screens modules in a sandbox: failures read in words with what to do and no route; a reasoned phase is closed with Mark done by hand; onePrimary keeps btn-primary only on the next open phase.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | BACKLOG B10/B13/B14: guard batched cad-edit execution in design-studio-orders.js, clear actionable 403 missing-access/role guidance without leaking routes, and pre-click engine container liveness diagnostics.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | BACKLOG B3/B15: guard sensors/controller rateHz & tickHz extraction in DesignStudioStages, reasoned-only unmeasured banners & closure lines in DesignStudioScreens, and Pi bay thermal solve brief collection/rendering.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 0.4.14 (BACKLOG B12, found by the non-administrator proof): an engine nobody has asked yet reads waiting and raises no banner, with the answers CAD Studio and Circuit Lab gave on a kernel; a failed or missing engine still reads stopped.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..', 'tools');
function load(file, key) {
  const sandbox = { window: {}, document: { getElementById: () => null }, fetch: async () => ({}) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(TOOLS, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window[key];
}
const S = load('design-studio-stages.js', 'DesignStudioStages');
const V = load('design-studio-screens.js', 'DesignStudioScreens');

test('an absent or failed engine is said in words, never as a route path', () => {
  const absent = S.absence({ status: 404, url: '/api/embodied/physics/reports?x=1', error: 'not found' }, 'embodied');
  assert.equal(absent.kind, 'absent');
  assert.equal(absent.line, 'no engine on this swarm for this phase (embodied is not installed or not answering here)');
  const failed = S.absence({ status: 503, url: '/api/embodied/physics/reports', error: 'the physics engine is unavailable' }, 'embodied');
  assert.equal(failed.kind, 'failed');
  assert.match(failed.line, /^embodied is not working on this installation right now: the physics engine is unavailable\. Try again later/);
  for (const r of [absent, failed]) assert.doesNotMatch(r.line, /\/api\//);
});

test('a phase no engine measures is closed by hand, said as such', () => {
  const v = S.phaseView({ brief: {} }, { kind: 'mechanical', engine: 'reasoned' }, { reads: {} }, {}, [], { produces: 'a mechanical spec' });
  assert.equal(v.stage, 'reasoned');
  assert.equal(v.action.label, 'Mark done by hand');
  assert.equal(v.action.byHand, true);
});

test('one primary on a product page: the next open phase', () => {
  const button = (id, text) => { const cls = new Set(['btn', 'btn-primary']); return { id, textContent: text, classList: { remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } }; };
  const buttons = [button('act-brief', 'Edit the brief'), button('act-design', 'Close the phase'), button('act-mechanical', 'Mark done by hand'), button('act-fabricate', 'Make the print set')];
  const host = { querySelectorAll: () => buttons };
  V.onePrimary(host, [
    { entry: { kind: 'brief' }, closure: { stale: false } },
    { entry: { kind: 'design' }, closure: null },
    { entry: { kind: 'mechanical' }, closure: null },
    { entry: { kind: 'fabricate' }, closure: null },
  ]);
  assert.deepEqual(buttons.filter((b) => b.classList.contains('btn-primary')).map((b) => b.id), ['act-design']);
});

test('B13: 403 refusals explain the missing access and administrator role step with no route path', () => {
  const denied = S.absence({ status: 403, url: '/api/cad-studio/models', error: 'no tier over cad-studio' }, 'cad-studio');
  assert.equal(denied.kind, 'refused');
  assert.match(denied.line, /CAD Studio refused this account \(HTTP 403\)/);
  assert.match(denied.line, /administrator/i);
  assert.match(denied.line, /role|access/i);
  assert.doesNotMatch(denied.line, /\/api\//);
  const unauth = S.absence({ status: 401, url: '/api/cad-studio/models', error: 'unauthenticated' }, 'cad-studio');
  assert.equal(unauth.kind, 'refused');
  assert.match(unauth.line, /sign in/i);
  assert.doesNotMatch(unauth.line, /\/api\//);
});

test('B14: engineLiveness detects stopped containers before any button is pressed', () => {
  assert.equal(typeof S.engineLiveness, 'function', 'DesignStudioStages exports engineLiveness');
  assert.equal(typeof S.engineBannerIssues, 'function', 'DesignStudioStages exports engineBannerIssues');
  const E = {
    reads: {
      status: { ok: true, status: 200, body: { engine: { connected: true, engine: 'mujoco', version: '3.3.5' } } },
      cadCaps: { ok: true, status: 200, body: { engine: { connected: false, reason: 'CAD engine container is stopped' } } },
      circuitCaps: { ok: true, status: 200, body: { engine: { connected: true } } },
      printCaps: { ok: true, status: 200, body: { slicerEngine: { connected: false, reason: 'slicer container stopped' } } },
    },
  };
  const live = S.engineLiveness(E);
  assert.equal(live.embodied.state, 'up');
  assert.equal(live['cad-studio'].state, 'stopped');
  assert.match(live['cad-studio'].reason, /stopped/i);
  assert.equal(live['scan-to-print'].state, 'stopped');
  const issues = S.engineBannerIssues({ phases: [{ kind: 'design', engine: 'cad-studio' }, { kind: 'fabricate', engine: 'scan-to-print' }] }, E);
  assert.equal(issues.length, 2);
  assert.deepEqual(Array.from(issues, (x) => x.engine), ['cad-studio', 'scan-to-print']);
});

test('an engine nobody has asked yet is waiting, not stopped, and raises no banner; a failed or missing one still does', () => {
  // The answers CAD Studio 0.5.4 and Circuit Lab 0.9.5 gave on a kernel: a pinned engine before its first request, and no engine at all.
  const pinned = { address: 'native://engine.exchange', buildHash: null, connected: false, contacted: false, expectedBuildHash: null, installHint: 'This application prepares its engine automatically when opened or used.', lastError: null, lifecycle: { state: 'pinned' } };
  const none = { ...pinned, lifecycle: { state: 'none' } };
  const reads = (cad, circuit) => ({ reads: { cadCaps: { ok: true, status: 200, body: { engine: cad } }, circuitCaps: { ok: true, status: 200, body: { engine: circuit } } } });
  const project = { phases: [{ kind: 'design', engine: 'cad-studio' }, { kind: 'electrical', engine: 'circuit-lab' }] };
  const fresh = S.engineLiveness(reads(pinned, none));
  assert.equal(fresh['cad-studio'].state, 'waiting');
  assert.doesNotMatch(fresh['cad-studio'].reason, /stopped/i);
  assert.equal(fresh['circuit-lab'].state, 'stopped', 'an installation with no engine for the application still says so');
  assert.deepEqual(Array.from(S.engineBannerIssues(project, reads(pinned, none)), (x) => x.engine), ['circuit-lab']);
  for (const state of ['ready', 'running', 'preparing', 'not-prepared']) assert.equal(S.engineLiveness(reads({ ...pinned, lifecycle: { state } }, none))['cad-studio'].state, 'waiting', state);
  // Once a request has failed, or the kernel says the engine failed, it is stopped again.
  const failed = { ...pinned, contacted: true, lastError: 'the kernel could not reach the engine container' };
  assert.equal(S.engineLiveness(reads(failed, none))['cad-studio'].state, 'stopped');
  assert.match(S.engineLiveness(reads(failed, none))['cad-studio'].reason, /stopped/i);
  assert.equal(S.engineLiveness(reads({ ...pinned, lifecycle: { state: 'failed' } }, none))['cad-studio'].state, 'stopped');
  assert.equal(S.engineLiveness(reads({ connected: false }, none))['cad-studio'].state, 'stopped', 'an answer that says only connected false is read as before');
  // After the first build CAD Studio answers connected true.
  assert.equal(S.engineLiveness(reads({ ...pinned, connected: true, contacted: true }, none))['cad-studio'].state, 'up');
  const pills = [];
  const fake = { textContent: '', append: (pill) => pills.push(pill) };
  const sandbox = { window: {}, document: { getElementById: () => null, createElement: () => { const node = { dataset: {}, className: '', textContent: '', setAttribute() {}, append() {} }; return node; } } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(TOOLS, 'design-studio-screens.js'), 'utf8'), sandbox, { filename: 'design-studio-screens.js' });
  sandbox.window.DesignStudioScreens.renderSettingsLiveness(fake, { 'cad-studio': fresh['cad-studio'] });
  assert.equal(pills[0].textContent, 'CAD Studio: not asked yet');
});

test('B10: DesignStudioOrders executes batched cad-edit features in sequence and stops honestly on failure', async () => {
  const calls = [];
  const sandbox = {
    window: {},
    document: { hidden: false },
    setInterval: () => 0,
    fetch: async (url, init) => {
      calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith('/orders/pending')) return { ok: true, status: 200, text: async () => JSON.stringify({ orders: [sandbox.__order] }) };
      if (url.endsWith('/claim')) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
      if (url.endsWith('/finish')) { sandbox.__finished = JSON.parse(init.body); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }; }
      if (url.includes('/api/cad-studio/models/m1/features')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ model: { model_id: 'm1', title: 'Plate', revision: calls.length, state: 'built', features: [] }, build: { ok: true } }) };
      }
      return { ok: false, status: 404, text: async () => '{}' };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(TOOLS, 'design-studio-orders.js'), 'utf8'), sandbox, { filename: 'design-studio-orders.js' });
  sandbox.__order = {
    id: 'ord-1', project_id: 'p1', action: 'cad-edit',
    input: { modelId: 'm1', features: [{ op: 'add', feature: { type: 'hole', diameter: 4 } }, { op: 'remove', featureId: 'f9' }] },
  };
  const pass = sandbox.window.DesignStudioOrders.start({
    project: () => ({ id: 'p1', name: 'Lift', phases: [] }), bindings: () => ({}), rows: () => [],
    openProduct: async () => {}, refresh: async () => {}, press: async () => null, say: () => {},
  });
  await pass();
  const cadCalls = calls.filter((c) => c.url.startsWith('/api/cad-studio/models/m1/features'));
  assert.equal(cadCalls.length, 2, 'batched cad-edit executes both feature operations in one order');
  assert.equal(cadCalls[0].method, 'POST');
  assert.equal(cadCalls[1].method, 'DELETE');
  assert.equal(sandbox.__finished.ok, true);
  assert.equal(sandbox.__finished.result.appliedCount, 2);
});

test('B3: DesignStudioStages records tickHz and sensor rateHz from embodied replies without inventing absent rates', () => {
  const E = {
    fit: { machine: 'hexapod', fit: 'spider-18' },
    reads: {
      designUrl: '/api/embodied/build/hexapod?fit=spider-18',
      design: {
        ok: true, status: 200,
        body: {
          spec: { servoCount: 18 },
          printed: [{ id: 'head', name: 'Head (LiDAR nose)' }],
          bought: [{ id: 'ld19-lidar', name: 'LD19 LiDAR', rateHz: 10 }, { id: 'bno055-imu', name: 'BNO055 IMU', rateHz: 100 }],
          senses: [{ name: 'lidar', rateHz: 10 }, { name: 'imu', rateHz: 100 }, { name: 'joints', rateHz: 50, count: 18 }],
        },
      },
      status: {
        ok: true, status: 200, url: '/api/embodied/physics/status',
        body: {
          engine: { connected: true, engine: 'mujoco', version: '3.3.5', buildHash: 'h1' },
          nodes: [{ nodeId: 'spider-pi', kind: 'hexapod', online: true, engine: 'hexapod-fake', version: '0.1.0', endpointUrl: 'http://spider-pi:7421', tickHz: 50, senses: [{ name: 'lidar', rateHz: 10 }, { name: 'imu', rateHz: 100 }, { name: 'joint-state', rateHz: 50 }] }],
        },
      },
    },
  };
  const ctrl = S.phaseView({ brief: {} }, { kind: 'controller', engine: 'embodied' }, E, { controller: { artifact: { engine: 'embodied', kind: 'node', nodeKind: 'hexapod' } } }, [], { produces: 'controller' });
  assert.equal(ctrl.read.node.tickHz, 50);
  assert.equal(ctrl.read.node.senses.find((s) => s.name === 'imu').rateHz, 100);
  const sens = S.phaseView({ brief: {} }, { kind: 'sensors', engine: 'embodied' }, E, { sensors: { artifact: { engine: 'embodied', kind: 'design-senses', senses: ['lidar', 'imu', 'joints'] } } }, [], { produces: 'sensors' });
  assert.deepEqual(sens.read.senses.map((s) => `${s.name}:${s.rateHz}`), ['lidar:10', 'imu:100', 'joints:50']);

  // Without engine rates, nothing is invented.
  const noRates = {
    fit: { machine: 'hexapod', fit: 'spider-18' },
    reads: {
      designUrl: '/api/embodied/build/hexapod?fit=spider-18',
      design: { ok: true, status: 200, body: { spec: { servoCount: 18 }, printed: [], bought: [{ id: 'ld19-lidar', name: 'LD19 LiDAR' }, { id: 'bno055-imu', name: 'BNO055 IMU' }] } },
      status: { ok: true, status: 200, url: '/api/embodied/physics/status', body: { engine: { connected: true, engine: 'mujoco', version: '3.3.5', buildHash: 'h1' }, nodes: [{ nodeId: 'spider-pi', kind: 'hexapod', online: true, engine: 'hexapod-fake', version: '0.1.0' }] } },
    },
  };
  const sensNone = S.phaseView({ brief: {} }, { kind: 'sensors', engine: 'embodied' }, noRates, { sensors: { artifact: { engine: 'embodied', kind: 'design-senses', senses: ['lidar', 'imu', 'joints'] } } }, [], { produces: 'sensors' });
  for (const s of sensNone.read.senses) assert.equal(s.rateHz, undefined);
});

test('B15: reasoned phases and Pi bay thermal solve render honest unmeasured banners and closure lines', () => {
  const mkNode = (tag) => {
    const node = { tagName: tag.toUpperCase(), className: '', dataset: {}, attrs: {}, children: [], textContent: '', value: '', checked: false, hidden: false,
      classList: { remove() {}, add() {} },
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; },
      append(...kids) { this.children.push(...kids); },
      querySelectorAll() { return []; },
    };
    return node;
  };
  const byId = new Map();
  for (const id of ['new-name', 'new-what', 'new-requirements', 'new-mass', 'new-size', 'new-cost', 'new-runtime', 'new-thermal-solve', 'new-thermal-note', 'phase-stepper']) {
    byId.set(id, mkNode('input'));
  }
  const sandbox = { window: {}, document: { getElementById: (id) => byId.get(id) || null, createElement: mkNode }, fetch: async () => ({}) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(TOOLS, 'design-studio-screens.js'), 'utf8'), sandbox, { filename: 'design-studio-screens.js' });
  const Screens = sandbox.window.DesignStudioScreens;

  byId.get('new-name').value = 'spider-18';
  byId.get('new-what').value = 'walking robot';
  byId.get('new-requirements').value = 'holds a Raspberry Pi';
  byId.get('new-thermal-solve').checked = true;
  byId.get('new-thermal-note').value = 'Pi 5 active cooler';
  const collected = Screens.collectBrief();
  assert.deepEqual(JSON.parse(JSON.stringify(collected.brief.thermalSolve)), { mode: 'pi-bay', note: 'Pi 5 active cooler' });

  const briefView = S.phaseView({ brief: { what: 'walking robot', requirements: ['holds a Raspberry Pi'], targets: {}, thermalSolve: { mode: 'pi-bay', status: 'reasoned-unmeasured', note: 'Pi 5 active cooler' } } }, { kind: 'brief', engine: 'reasoned' }, { reads: {} }, {}, [], { produces: 'brief' });
  assert.match(briefView.thermalNote, /Pi bay thermal solve requested.*no thermal engine measured this yet \(reasoned only\)/);

  const mechView = S.phaseView({ brief: {} }, { kind: 'mechanical', engine: 'reasoned' }, { reads: {} }, {}, [], { produces: 'a mechanical spec' });
  assert.equal(mechView.reasonedOnly, true);
  assert.match(mechView.unmeasuredBanner, /No engine measured this phase \(reasoned only\)/);
  const customRevClosure = S.closureOf('mechanical', [{ phase: 'mechanical', step: null, revision: 'hand-calc-r1', closed_at: '2026-11-19T00:00:00Z' }], mechView);
  assert.equal(customRevClosure.stale, false, 'a reasoned closure with a user-typed revision is not marked stale against the placeholder revision');

  const host = mkNode('section');
  const mechClosure = { phase: 'mechanical', revision: 'reasoned', closed_by: 'person', closed_at: '2026-11-19T00:00:00Z', reasonedOnly: true, measuredByEngine: false, unmeasuredNotice: 'no engine measured this phase (reasoned only)', stale: false };
  Screens.renderProduct(host, { phases: [{ kind: 'brief', engine: 'reasoned' }, { kind: 'mechanical', engine: 'reasoned' }] }, [
    { entry: { kind: 'brief', engine: 'reasoned' }, view: briefView, closure: null },
    { entry: { kind: 'mechanical', engine: 'reasoned' }, view: mechView, closure: mechClosure },
  ], () => {});
  const flat = (n) => [n, ...(n.children || []).flatMap(flat)];
  const nodes = flat(host);
  assert.ok(nodes.some((n) => n.id === 'brief-thermal-note' && /Pi bay thermal solve/.test(n.textContent)));
  assert.ok(nodes.some((n) => n.id === 'mechanical-unmeasured-banner' && /No engine measured this phase \(reasoned only\)/.test(n.textContent)));
  const closedP = nodes.find((n) => n.className.includes('closed unmeasured'));
  assert.ok(closedP, 'reasoned closure carries .closed.unmeasured class');
  assert.match(closedP.textContent, /closed \(reasoned only — no engine measured this phase\)/);
  assert.equal(closedP.dataset.reasonedOnly, '1');
  assert.equal(closedP.dataset.measuredByEngine, '0');
});
