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
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const c = require(path.resolve(__dirname, '..', 'routes', 'feature-contract.js'));
const { engineBuildHash, RUNTIME_FILES } = require(path.resolve(__dirname, '..', 'routes', 'engine-build-hash.js'));
const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');

test('the contract names exactly the engine\'s bases, features and selectors', () => {
  assert.deepEqual([...c.BASE_KINDS], ['box', 'cylinder', 'sketch', 'contours', 'mesh']);
  assert.deepEqual([...c.FEATURE_TYPES], ['hole', 'boss', 'box-add', 'box-cut', 'sketch-extrude', 'fillet', 'chamfer', 'shell', 'cut-plane', 'scale', 'mirror', 'rotate', 'translate']);
  assert.deepEqual([...c.EDGE_SELECTORS], ['all', 'vertical', 'horizontal', 'top', 'bottom', 'parallel-x', 'parallel-y', 'parallel-z']);
  assert.deepEqual([...c.FACE_SELECTORS], ['none', 'top', 'bottom', 'front', 'back', 'left', 'right']);
  const published = c.describeContract();
  assert.deepEqual(Object.keys(published.features).sort(), [...c.FEATURE_TYPES].sort());
  assert.match(published.worldFrame, /Z up/);
  assert.equal(c.FEATURE_INPUT_SCHEMA.required.join(','), 'type,params');
});

test('every feature type normalises a valid example and refuses a bad one with the field named', () => {
  const ok = {
    'hole': { diameter: 6, x: 10, y: 0 }, 'boss': { diameter: 8, height: 5, from: 20 }, 'box-add': { size: [10, 10, 10], center: [0, 0, 25] },
    'box-cut': { size: [10, 10, 30] }, 'sketch-extrude': { points: [[0, 0], [10, 0], [0, 10]], height: 4, offset: 20, mode: 'cut' },
    'fillet': { radius: 2, edges: 'vertical' }, 'chamfer': { length: 1 }, 'shell': { thickness: 2, openFace: 'top' },
    'cut-plane': { at: 15, keep: 'above' }, 'scale': { factor: 2 }, 'mirror': { plane: 'XZ' }, 'rotate': { degrees: 90, axis: 'x' }, 'translate': { dz: 5 },
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
    [{ type: 'holes', params: {} }, 'type'],
    [{ type: 'hole', params: { diameter: 6 }, enabled: 'yes' }, 'enabled'],
    ['not an object', 'feature'],
  ];
  for (const [input, field] of bad) {
    assert.throws(() => c.validateFeature(input), (err) => err instanceof c.ContractError && err.field === field, `expected ${field} for ${JSON.stringify(input)}`);
  }
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
