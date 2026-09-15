/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the feature contract under plain node: every
 *                     |                             | base kind and feature type normalises, ranges and
 *                     |                             | selectors are enforced with the field named, unknown
 *                     |                             | parameters are refused (a typo must never be a silent
 *                     |                             | no-op), ids are kept on update and minted on add, the
 *                     |                             | list refuses duplicates and the cap, the published
 *                     |                             | contract lists exactly the engine's names, and the
 *                     |                             | Node and Python engine build hashes agree.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | revolve, sweep and loft (BACKLOG B1): each normalises a valid
 *                     |                             | example and refuses a bad one naming the field — a revolve
 *                     |                             | axis outside its plane, a one-point path, a single section,
 *                     |                             | a bad point in section 1, a repeated offset, a typo inside a
 *                     |                             | section — and the published contract lists the plane->axis
 *                     |                             | table the worker publishes. The worker's FEATURES registry and
 *                     |                             | PLANE_AXES are read from cad_worker.py's source and must equal
 *                     |                             | the contract's, so a type added on one side only goes red here
 *                     |                             | (store CI has no kernel; this needs none).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | The per-feature budget (BACKLOG B5): the setting is refused
 *                     |                             | by field outside the range, the range is published, and it
 *                     |                             | equals the worker's FEATURE_BUDGET_MS read from source.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const c = require(path.resolve(__dirname, '..', 'routes', 'feature-contract.js'));
const { engineBuildHash, RUNTIME_FILES } = require(path.resolve(__dirname, '..', 'routes', 'engine-build-hash.js'));
const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');

test('the contract names exactly the engine\'s bases, features and selectors', () => {
  assert.deepEqual([...c.BASE_KINDS], ['box', 'cylinder', 'sketch', 'contours', 'mesh']);
  assert.deepEqual([...c.FEATURE_TYPES], ['hole', 'boss', 'box-add', 'box-cut', 'sketch-extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer', 'shell', 'cut-plane', 'scale', 'mirror', 'rotate', 'translate']);
  assert.deepEqual([...c.EDGE_SELECTORS], ['all', 'vertical', 'horizontal', 'top', 'bottom', 'parallel-x', 'parallel-y', 'parallel-z']);
  assert.deepEqual([...c.FACE_SELECTORS], ['none', 'top', 'bottom', 'front', 'back', 'left', 'right']);
  const published = c.describeContract();
  assert.deepEqual(Object.keys(published.features).sort(), [...c.FEATURE_TYPES].sort());
  assert.match(published.worldFrame, /Z up/);
  assert.deepEqual(JSON.parse(JSON.stringify(published.planeAxes)), { XY: ['x', 'y'], XZ: ['x', 'z'], YZ: ['y', 'z'] });
  assert.equal(published.limits.maxSections, 32);
  assert.equal(c.FEATURE_INPUT_SCHEMA.required.join(','), 'type,params');
});

test('every feature type normalises a valid example and refuses a bad one with the field named', () => {
  const ok = {
    'hole': { diameter: 6, x: 10, y: 0 }, 'boss': { diameter: 8, height: 5, from: 20 }, 'box-add': { size: [10, 10, 10], center: [0, 0, 25] },
    'box-cut': { size: [10, 10, 30] }, 'sketch-extrude': { points: [[0, 0], [10, 0], [0, 10]], height: 4, offset: 20, mode: 'cut' },
    'fillet': { radius: 2, edges: 'vertical' }, 'chamfer': { length: 1 }, 'shell': { thickness: 2, openFace: 'top' },
    'cut-plane': { at: 15, keep: 'above' }, 'scale': { factor: 2 }, 'mirror': { plane: 'XZ' }, 'rotate': { degrees: 90, axis: 'x' }, 'translate': { dz: 5 },
    'revolve': { points: [[10, 0], [20, 0], [20, 30], [10, 30]], plane: 'XZ', axis: 'z', degrees: 90, mode: 'cut' },
    'sweep': { points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], path: [[0, 0], [0, 40], [30, 40]], plane: 'XY', pathPlane: 'XZ' },
    'loft': { sections: [{ points: [[-10, -10], [10, -10], [10, 10], [-10, 10]], offset: 20 }, { points: [[-5, -5], [5, -5], [5, 5], [-5, 5]], offset: 50 }], ruled: false, plane: 'XY' },
  };
  for (const [type, params] of Object.entries(ok)) {
    const f = c.validateFeature({ type, params, label: 'x' });
    assert.equal(f.type, type); assert.equal(f.enabled, true); assert.match(f.id, /^[0-9a-f-]{36}$/); assert.deepEqual(f.params, params);
  }
  const bad = [
    [{ type: 'hole', params: { diameter: 0 } }, 'hole.params.diameter'],
    [{ type: 'hole', params: { diameter: 6, axis: 'w' } }, 'hole.params.axis'],
    [{ type: 'hole', params: { diameter: 6, depth: 3, through: true } }, 'params.through'],
    [{ type: 'fillet', params: { radius: 2, edges: 'inner' } }, 'fillet.params.edges'],
    [{ type: 'fillet', params: { radius: 2, radiu: 3 } }, 'params.radiu'],
    [{ type: 'boss', params: { diameter: 8 } }, 'params.height'],
    [{ type: 'box-add', params: { size: [10, 10] } }, 'box-add.params.size'],
    [{ type: 'sketch-extrude', params: { points: [[0, 0], [1, 0]], height: 1 } }, 'sketch-extrude.params.points'],
    [{ type: 'scale', params: {} }, 'params'],
    [{ type: 'rotate', params: { degrees: 400 } }, 'rotate.params.degrees'],
    [{ type: 'revolve', params: {} }, 'params.points'],
    [{ type: 'revolve', params: { points: [[1, 0], [2, 0], [2, 3]], axis: 'y' } }, 'params.axis'],
    [{ type: 'revolve', params: { points: [[1, 0], [2, 0], [2, 3]], plane: 'XY', axis: 'z' } }, 'params.axis'],
    [{ type: 'revolve', params: { points: [[1, 0], [2, 0], [2, 3]], degrees: 0 } }, 'revolve.params.degrees'],
    [{ type: 'revolve', params: { points: [[1, 0], [2, 0], [2, 3]], plane: 'ZX' } }, 'revolve.params.plane'],
    [{ type: 'sweep', params: { points: [[0, 0], [1, 0], [0, 1]] } }, 'params.path'],
    [{ type: 'sweep', params: { points: [[0, 0], [1, 0], [0, 1]], path: [[0, 0]] } }, 'sweep.params.path'],
    [{ type: 'sweep', params: { points: [[0, 0], [1, 0], [0, 1]], path: [[0, 0], [0, 'up']] } }, 'sweep.params.path[1][1]'],
    [{ type: 'sweep', params: { points: [[0, 0], [1, 0], [0, 1]], path: [[0, 0], [0, 9]], pathPlane: 'XX' } }, 'sweep.params.pathPlane'],
    [{ type: 'loft', params: {} }, 'params.sections'],
    [{ type: 'loft', params: { sections: [{ points: [[0, 0], [1, 0], [0, 1]], offset: 0 }] } }, 'loft.params.sections'],
    [{ type: 'loft', params: { sections: [{ points: [[0, 0], [1, 0], [0, 1]] }, { points: [[0, 0], [1, 0]], offset: 5 }] } }, 'loft.params.sections[1].points'],
    [{ type: 'loft', params: { sections: [{ points: [[0, 0], [1, 0], [0, 1]] }, { points: [[0, 0], [1, 0], [0, 1]], offst: 5 }] } }, 'loft.params.sections[1].offst'],
    [{ type: 'loft', params: { sections: [{ points: [[0, 0], [1, 0], [0, 1]] }, 'square'] } }, 'loft.params.sections[1]'],
    [{ type: 'loft', params: { sections: [{ points: [[0, 0], [1, 0], [0, 1]], offset: 5 }, { points: [[0, 0], [2, 0], [0, 2]], offset: 5 }] } }, 'params.sections[1].offset'],
    [{ type: 'loft', params: { sections: [{ points: [[0, 0], [1, 0], [0, 1]] }, { points: [[0, 0], [2, 0], [0, 2]], offset: 5 }], ruled: 'yes' } }, 'loft.params.ruled'],
    [{ type: 'loft', params: { sections: Array.from({ length: 33 }, (_, i) => ({ points: [[0, 0], [1, 0], [0, 1]], offset: i })) } }, 'loft.params.sections'],
    [{ type: 'holes', params: {} }, 'type'],
    [{ type: 'hole', params: { diameter: 6 }, enabled: 'yes' }, 'enabled'],
    ['not an object', 'feature'],
  ];
  for (const [input, field] of bad) {
    assert.throws(() => c.validateFeature(input), (err) => err instanceof c.ContractError && err.field === field, `expected ${field} for ${JSON.stringify(input)}`);
  }
});

test('revolve, sweep and loft keep the engine defaults implicit and normalise section offsets', () => {
  // Omitted optionals stay omitted: the worker owns the defaults (XZ / its second axis / 360 degrees),
  // so the stored list never freezes a default the engine might later state differently.
  const rev = c.validateFeature({ type: 'revolve', params: { points: [[0, 0], [5, 0], [5, 30], [0, 30]] } });
  assert.deepEqual(Object.keys(rev.params), ['points']);
  // An axis in the plane is accepted for every plane, both of its axes.
  for (const [plane, axes] of Object.entries(c.PLANE_AXES)) {
    for (const axis of axes) assert.equal(c.validateFeature({ type: 'revolve', params: { points: [[1, 0], [2, 0], [2, 3]], plane, axis } }).params.axis, axis);
  }
  // A section with no offset sits on the plane itself (0); the rest keep their order.
  const loft = c.validateFeature({ type: 'loft', params: { sections: [{ points: [[0, 0], [4, 0], [0, 4]] }, { points: [[0, 0], [2, 0], [0, 2]], offset: 12 }] } });
  assert.deepEqual(loft.params.sections.map((s) => s.offset), [0, 12]);
  // A refused revolve axis names the axes the plane actually has, so the agent can correct it.
  assert.throws(() => c.validateFeature({ type: 'revolve', params: { points: [[1, 0], [2, 0], [2, 3]], plane: 'YZ', axis: 'x' } }), /one of y, z for plane YZ/);
});

test('the worker registers exactly the contract\'s feature types and plane axes (read from its source)', () => {
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'cad_worker.py'), 'utf8').replace(/\r\n/g, '\n');
  const registry = /^FEATURES = \{([\s\S]*?)^\}/m.exec(source);
  assert.ok(registry, 'cad_worker.py must declare a FEATURES = { … } registry');
  const engineTypes = [...registry[1].matchAll(/"([a-z-]+)":\s*feat_[a-z_]+/g)].map((m) => m[1]);
  assert.deepEqual(engineTypes.slice().sort(), [...c.FEATURE_TYPES].sort(), 'the worker and the contract must name the same feature types');
  const axes = /^PLANE_AXES = (\{.*\})$/m.exec(source);
  assert.ok(axes, 'cad_worker.py must declare PLANE_AXES on one line');
  const engineAxes = JSON.parse(axes[1].replace(/\(/g, '[').replace(/\)/g, ']'));
  assert.deepEqual(engineAxes, JSON.parse(JSON.stringify(c.PLANE_AXES)));
  assert.match(source, /^MAX_SECTIONS = 32$/m, 'the worker section cap must equal LIMITS.maxSections');
  const budget = /^FEATURE_BUDGET_MS = (\{.*\})$/m.exec(source);
  assert.ok(budget, 'cad_worker.py must declare FEATURE_BUDGET_MS on one line');
  assert.deepEqual(JSON.parse(budget[1]), { ...c.FEATURE_BUDGET_MS });
});

test('the per-feature budget setting is a whole number of ms inside the published range', () => {
  assert.equal(c.validateFeatureBudget(1), 1);
  assert.equal(c.validateFeatureBudget(600000), 600000);
  for (const bad of [0, 600001, 1.5, '5000', null, true, Number.NaN]) {
    assert.throws(() => c.validateFeatureBudget(bad), (err) => err instanceof c.ContractError && err.field === 'settings.featureBudgetMs', `expected a refusal for ${String(bad)}`);
  }
  const published = c.describeContract();
  assert.deepEqual({ ...published.featureBudgetMs }, { min: 1, max: 600000 });
  assert.ok(published.rules.some((r) => /budget_exceeded/.test(r) && /cancel/.test(r)), 'the rules name the budget refusal and the cancel');
});

test('update keeps the id, add keeps a well-formed supplied id and replaces a bad one', () => {
  const kept = c.validateFeature({ type: 'hole', params: { diameter: 3 } }, 'abc-123');
  assert.equal(kept.id, 'abc-123');
  assert.equal(c.validateFeature({ id: 'hole_1', type: 'hole', params: { diameter: 3 } }).id, 'hole_1');
  assert.match(c.validateFeature({ id: '../x', type: 'hole', params: { diameter: 3 } }).id, /^[0-9a-f-]{36}$/);
});

test('bases normalise; contours accept only the three outline views; mesh needs base64', () => {
  assert.deepEqual(c.validateBase({ kind: 'box', sizeX: 1, sizeY: 2, sizeZ: 3 }), { kind: 'box', sizeX: 1, sizeY: 2, sizeZ: 3 });
  assert.deepEqual(c.validateBase({ kind: 'cylinder', diameter: 10, height: 5 }), { kind: 'cylinder', diameter: 10, height: 5 });
  assert.equal(c.validateBase({ kind: 'sketch', points: [[0, 0], [1, 0], [0, 1]], height: 2 }).plane, 'XY');
  const contours = c.validateBase({ kind: 'contours', views: { front: [[-30, 0], [30, 0], [30, 30]], top: [[-30, -20], [30, -20], [0, 20]] }, size: { x: 60, y: 40, z: 30 } });
  assert.deepEqual(Object.keys(contours.views), ['front', 'top']);
  assert.throws(() => c.validateBase({ kind: 'contours', views: { back: [[0, 0], [1, 0], [0, 1]] } }), /front, top, right/);
  assert.throws(() => c.validateBase({ kind: 'contours', views: {} }), /at least one outline/);
  assert.equal(c.validateBase({ kind: 'mesh', stl: 'AAAA' }).kind, 'mesh');
  assert.throws(() => c.validateBase({ kind: 'mesh', stl: '' }), /base64/);
  assert.throws(() => c.validateBase({ kind: 'sphere' }), /base.kind/);
  assert.throws(() => c.validateBase({ kind: 'box', sizeX: 5000, sizeY: 1, sizeZ: 1 }), /between/);
});

test('a feature list refuses duplicates and the cap, and keeps order', () => {
  const list = c.validateFeatureList([{ id: 'a', type: 'hole', params: { diameter: 1 } }, { id: 'b', type: 'fillet', params: { radius: 1 } }]);
  assert.deepEqual(list.map((f) => f.id), ['a', 'b']);
  assert.throws(() => c.validateFeatureList([{ id: 'a', type: 'hole', params: { diameter: 1 } }, { id: 'a', type: 'hole', params: { diameter: 1 } }]), /duplicate/);
  assert.throws(() => c.validateFeatureList(Array.from({ length: 201 }, () => ({ type: 'hole', params: { diameter: 1 } }))), /at most 200/);
  assert.throws(() => c.validateFeatureList({}), /must be a list/);
});

test('the Node build hash equals the bridge\'s Python build hash for the shipped engine tree', () => {
  const node = engineBuildHash(ENGINE_DIR);
  assert.match(node, /^[0-9a-f]{64}$/);
  assert.equal(engineBuildHash(path.join(ENGINE_DIR, 'does-not-exist')), null);
  assert.deepEqual([...RUNTIME_FILES], ['cad_worker.py', 'container/cad_engine_bridge.py', 'requirements.txt', 'requirements-lock.txt']);
  const bridge = path.join(ENGINE_DIR, 'container', 'cad_engine_bridge.py');
  let result = null;
  for (const bin of ['python3', 'python']) {
    const run = spawnSync(bin, [bridge, '--build-hash'], { encoding: 'utf8', env: { ...process.env, CAD_STUDIO_ENGINE_DIR: ENGINE_DIR } });
    if (!run.error && run.status === 0) { result = run.stdout.trim(); break; }
  }
  assert.ok(result, 'a python interpreter is required for the cross-implementation hash check (python3 or python)');
  assert.equal(result, node, 'the bridge and the api must agree on the engine build hash');
});
