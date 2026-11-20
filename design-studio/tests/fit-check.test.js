/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B9: unit + surface integration tests for joint fit /
 *                     |                             | interference clearance check (compiled routes/fit-check.js and
 *                     |                             | browser tools/design-studio-fit.js parity) and honest strength
 *                     |                             | reporting on the Design poster. Covers positive clearance fit
 *                     |                             | (allows parts-complete), tight FDM clearance warning (< 0.2 mm),
 *                     |                             | negative clearance interference (blocks parts-complete with
 *                     |                             | exact joint, part pair, and mm value), misaligned/failed pockets,
 *                     |                             | cylindrical shaft-in-bore clearance & interference, unverified
 *                     |                             | geometry refusal, unmeasured load strength honesty notice, and
 *                     |                             | measured engine strength display.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const ServerFit = require(path.join(PKG, 'routes', 'fit-check.js'));
const { LIFT_1_EXAMPLE, LIFT_1_MECHANISM } = require(path.join(PKG, 'routes', 'examples.js'));

function loadBrowserModules() {
  const sandbox = { window: {}, document: { getElementById: () => null }, fetch: async () => ({}) };
  vm.createContext(sandbox);
  for (const file of ['design-studio-fit.js', 'design-studio-stages.js', 'design-studio-screens.js']) {
    vm.runInContext(fs.readFileSync(path.join(PKG, 'tools', file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window;
}
const Browser = loadBrowserModules();
const BrowserFit = Browser.DesignStudioFit;
const Stages = Browser.DesignStudioStages;

function liftParts(carriageBoxCut = { size: [42, 42, 42], center: [0, 0, 20] }, carriageFeatureStatus = []) {
  return [
    { model_id: 'm-base', id: 'base', title: 'lift-1 · Base plate', revision: 1, state: 'built', base: { kind: 'box', sizeX: 200, sizeY: 200, sizeZ: 10 }, features: [{ id: 'foot-pp', type: 'hole', params: { diameter: 5, axis: 'z', x: 85, y: 85 } }], feature_status: [] },
    { model_id: 'm-col', id: 'column', title: 'lift-1 · Column', revision: 1, state: 'built', base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 400 }, features: [{ id: 'cap-pin', type: 'hole', params: { diameter: 6, axis: 'y', x: 0, z: 390 } }], feature_status: [] },
    { model_id: 'm-car', id: 'carriage', title: 'lift-1 · Carriage', revision: 1, state: 'built', base: { kind: 'box', sizeX: 80, sizeY: 60, sizeZ: 40 }, features: [...(carriageBoxCut ? [{ id: 'bore', type: 'box-cut', params: carriageBoxCut }] : []), { id: 'set-screw', type: 'hole', params: { diameter: 5, axis: 'x', y: 25, z: 20 } }], feature_status: carriageFeatureStatus },
  ];
}

const LIFT_BINDING = {
  engine: 'cad-studio', kind: 'cad-models',
  modelIds: ['m-base', 'm-col', 'm-car'],
  models: [{ partId: 'base', modelId: 'm-base' }, { partId: 'column', modelId: 'm-col' }, { partId: 'carriage', modelId: 'm-car' }],
};

test('clearance fit (> 0 mm on sliding pocket, 0 mm fixed mount) passes in both server and browser modules', () => {
  const input = { brief: LIFT_1_EXAMPLE.brief, mechanism: LIFT_1_MECHANISM, binding: LIFT_BINDING, parts: liftParts() };
  for (const [label, Fit] of [['server', ServerFit], ['browser', BrowserFit]]) {
    const out = Fit.evaluateDesignFit(input);
    assert.equal(out.ok, true, label);
    assert.equal(out.verdict, 'fit', label);
    assert.equal(out.minClearanceMm, 0, label);
    assert.equal(out.joints[0].jointId, 'column-mount', label);
    assert.equal(out.joints[0].clearanceMm, 0, label);
    assert.equal(out.joints[0].tightFit, false, 'fixed face-to-face mount has no moving-joint tight warning');
    assert.equal(out.joints[1].jointId, 'carriage-slide', label);
    assert.equal(out.joints[1].clearanceMm, 1, label);
    assert.equal(out.joints[1].matingFeature, 'bore', label);
    assert.equal(out.warnings.length, 0, label);
  }
});

test('tight clearance (< 0.2 mm FDM tolerance) on a moving joint passes fit with an explicit warning', () => {
  const out = ServerFit.evaluateDesignFit({ brief: LIFT_1_EXAMPLE.brief, mechanism: LIFT_1_MECHANISM, binding: LIFT_BINDING, parts: liftParts({ size: [40.2, 40.2, 42], center: [0, 0, 20] }) });
  assert.equal(out.ok, true);
  assert.equal(out.verdict, 'fit');
  const slide = out.joints.find((j) => j.jointId === 'carriage-slide');
  assert.equal(slide.clearanceMm, 0.1);
  assert.equal(slide.tightFit, true);
  assert.match(slide.warning, /0\.10 mm < 0\.20 mm FDM tolerance/);
  assert.equal(out.warnings.length, 1);
});

test('interference (< 0 mm) from undersized, misaligned, missing, or failed pockets is refused with exact mm', () => {
  const cases = [
    ['undersized 38x38 pocket', liftParts({ size: [38, 38, 42], center: [0, 0, 20] }), -1],
    ['misaligned +2mm pocket', liftParts({ size: [42, 42, 42], center: [2, 0, 20] }), -1],
    ['no pocket (only edge set-screw hole)', liftParts(null), -40],
    ['failed pocket feature in feature_status', liftParts({ size: [42, 42, 42], center: [0, 0, 20] }, [{ id: 'bore', ok: false, error: 'kernel refused' }]), -40],
  ];
  for (const [label, parts, expectedMm] of cases) {
    for (const Fit of [ServerFit, BrowserFit]) {
      const out = Fit.evaluateDesignFit({ brief: LIFT_1_EXAMPLE.brief, mechanism: LIFT_1_MECHANISM, binding: LIFT_BINDING, parts });
      assert.equal(out.ok, false, label);
      assert.equal(out.verdict, 'interference', label);
      assert.equal(out.minClearanceMm, expectedMm, label);
      assert.equal(out.blockingJoints.length, 1, label);
      assert.equal(out.blockingJoints[0].jointId, 'carriage-slide', label);
      assert.equal(out.blockingJoints[0].clearanceMm, expectedMm, label);
      assert.match(out.summary, /carriage-slide \(column \/ carriage\): -\d+\.\d{2} mm interference/, label);
    }
  }
});

test('cylindrical shaft inside cylindrical bore computes radial clearance and catches interference', () => {
  const mech = {
    parts: [{ id: 'shaft', name: 'Shaft', modelId: 'm-s' }, { id: 'hub', name: 'Hub', modelId: 'm-h' }],
    base: 'shaft',
    joints: [{ id: 'pivot', parent: 'shaft', child: 'hub', type: 'hinge', axis: [0, 0, 1], rangeRad: [-1, 1], rangeM: null, originMm: [0, 0, 10], drivenBy: null, gearRatio: null }],
    motors: [], payload: null, task: null,
  };
  const shaft = { model_id: 'm-s', id: 'shaft', state: 'built', base: { kind: 'cylinder', diameter: 10, height: 50 }, features: [] };
  const hubFit = { model_id: 'm-h', id: 'hub', state: 'built', base: { kind: 'cylinder', diameter: 24, height: 15 }, features: [{ id: 'bore', type: 'hole', params: { axis: 'z', diameter: 10.6 } }] };
  const hubTight = { model_id: 'm-h', id: 'hub', state: 'built', base: { kind: 'cylinder', diameter: 24, height: 15 }, features: [{ id: 'bore', type: 'hole', params: { axis: 'z', diameter: 9.5 } }] };
  const pass = ServerFit.evaluateDesignFit({ mechanism: mech, parts: [shaft, hubFit] });
  assert.equal(pass.verdict, 'fit'); assert.equal(pass.minClearanceMm, 0.3); assert.equal(pass.joints[0].matingFeature, 'bore');
  const fail = ServerFit.evaluateDesignFit({ mechanism: mech, parts: [shaft, hubTight] });
  assert.equal(fail.verdict, 'interference'); assert.equal(fail.minClearanceMm, -0.25);
});

test('unbuilt or missing joint parts produce unverified verdict rather than silent pass', () => {
  const parts = liftParts();
  parts[2].state = 'failed';
  const out = ServerFit.evaluateDesignFit({ mechanism: LIFT_1_MECHANISM, binding: LIFT_BINDING, parts });
  assert.equal(out.ok, false);
  assert.equal(out.verdict, 'unverified');
  assert.equal(out.blockingJoints[0].jointId, 'carriage-slide');
  assert.match(out.blockingJoints[0].reason, /failed, not built/);
});

test('strength honesty explicitly reports unmeasured load when no engine measured it, and displays measured engine strength when present', () => {
  const unmeasured = ServerFit.evaluateStrength(LIFT_1_EXAMPLE.brief, LIFT_1_MECHANISM, LIFT_BINDING);
  assert.equal(unmeasured.measured, false);
  assert.equal(unmeasured.status, 'unmeasured');
  assert.match(unmeasured.line, /No engine strength estimate measured for 2 kg payload on carriage/);

  const reasonedFake = ServerFit.evaluateStrength(LIFT_1_EXAMPLE.brief, LIFT_1_MECHANISM, { ...LIFT_BINDING, read: { strength: { engine: 'reasoned', safetyFactor: 5 } } });
  assert.equal(reasonedFake.measured, false, 'reasoned never counts as an engine strength measurement');

  const measured = ServerFit.evaluateStrength(LIFT_1_EXAMPLE.brief, LIFT_1_MECHANISM, { ...LIFT_BINDING, read: { strength: { engine: 'calculix-fea', safetyFactor: 2.4, maxStressMpa: 18.2, allowableStressMpa: 43.7 } } });
  assert.equal(measured.measured, true);
  assert.equal(measured.status, 'ok');
  assert.equal(measured.safetyFactor, 2.4);
  assert.match(measured.line, /safety factor 2\.40 \(18\.2 MPa \/ 43\.7 MPa\) measured by calculix-fea/);
});

test('Design poster blocks parts-complete on interference, passes on fit, and always states strength honesty', () => {
  const project = { id: 'p1', name: 'lift-1', brief: LIFT_1_EXAMPLE.brief, phases: LIFT_1_EXAMPLE.phases };
  const entry = { kind: 'design', engine: 'cad-studio' };
  const mkE = (parts) => ({ reads: { models: { ok: true, status: 200, url: '/api/cad-studio/models', body: { models: parts } }, mechanism: { ok: true, status: 200, url: '/api/design-studio/projects/p1/mechanism', body: { mechanism: LIFT_1_MECHANISM, revision: 1 } } } });

  const fitView = Stages.phaseView(project, entry, mkE(liftParts()), { design: { artifact: LIFT_BINDING } }, [], { produces: 'parts' });
  assert.equal(fitView.stage, 'parts-complete');
  assert.equal(fitView.met, true);
  assert.match(fitView.fitNote, /carriage-slide \+1\.00 mm/);
  assert.match(fitView.strengthNote, /No engine strength estimate measured for 2 kg payload on carriage/);
  assert.equal(fitView.strengthStatus, 'unmeasured');

  const badView = Stages.phaseView(project, entry, mkE(liftParts({ size: [38, 38, 42], center: [0, 0, 20] })), { design: { artifact: LIFT_BINDING } }, [], { produces: 'parts' });
  assert.equal(badView.stage, 'interference');
  assert.equal(badView.met, false, 'interference must block parts-complete');
  assert.equal(badView.figure[0], '-1.00 mm');
  assert.match(badView.line, /carriage-slide \(column \/ carriage\): -1\.00 mm interference/);
  assert.equal(badView.action.label, 'Open in CAD Studio');

  const measuredBinding = { ...LIFT_BINDING, read: { strength: { engine: 'calculix-fea', safetyFactor: 2.1, maxStressMpa: 20, allowableStressMpa: 42 } } };
  const measuredView = Stages.phaseView(project, entry, mkE(liftParts()), { design: { artifact: measuredBinding } }, [], { produces: 'parts' });
  assert.equal(measuredView.stage, 'parts-complete');
  assert.equal(measuredView.strengthStatus, 'ok');
  assert.match(measuredView.strengthNote, /safety factor 2\.10 \(20 MPa \/ 42 MPa\) measured by calculix-fea/);
});

test('DesignStudioScreens renders #design-fit-note and #design-strength-note on the poster using token-only CSS', () => {
  const nodes = [];
  const mkNode = (tag) => ({
    tag, attrs: {}, dataset: {}, className: '', textContent: '', children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...kids) { this.children.push(...kids); },
    querySelectorAll() { return []; },
  });
  const sandbox = { window: {}, document: { getElementById: () => null, createElement: mkNode }, fetch: async () => ({}) };
  vm.createContext(sandbox);
  for (const file of ['design-studio-fit.js', 'design-studio-stages.js', 'design-studio-screens.js']) {
    vm.runInContext(fs.readFileSync(path.join(PKG, 'tools', file), 'utf8'), sandbox, { filename: file });
  }
  const host = mkNode('section');
  const project = { id: 'p1', name: 'lift-1', brief: LIFT_1_EXAMPLE.brief, phases: [{ kind: 'design', engine: 'cad-studio' }] };
  const entry = { kind: 'design', engine: 'cad-studio' };
  const E = { reads: { models: { ok: true, status: 200, url: '/api/cad-studio/models', body: { models: liftParts() } }, mechanism: { ok: true, status: 200, url: '/api/design-studio/projects/p1/mechanism', body: { mechanism: LIFT_1_MECHANISM, revision: 1 } } } };
  const view = sandbox.window.DesignStudioStages.phaseView(project, entry, E, { design: { artifact: LIFT_BINDING } }, [], { produces: 'parts' });
  sandbox.window.DesignStudioScreens.renderProduct(host, project, [{ entry, view, closure: null }], () => {});
  const walk = (n) => { nodes.push(n); for (const c of n.children || []) walk(c); };
  walk(host);
  const fitEl = nodes.find((n) => n.attrs.id === 'design-fit-note');
  const strEl = nodes.find((n) => n.attrs.id === 'design-strength-note');
  assert.ok(fitEl, '#design-fit-note rendered on Design poster');
  assert.match(fitEl.textContent, /carriage-slide \+1\.00 mm/);
  assert.ok(strEl, '#design-strength-note rendered on Design poster');
  assert.equal(strEl.dataset.strengthStatus, 'unmeasured');
  assert.match(strEl.textContent, /No engine strength estimate measured/);
  const css = fs.readFileSync(path.join(PKG, 'tools', 'design-studio.css'), 'utf8');
  for (const m of css.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    assert.match(css.slice(Math.max(0, m.index - 60), m.index), /var\(--[a-z-]+,\s*$/, `CSS color ${m[0]} must be a theme token fallback`);
  }
});
