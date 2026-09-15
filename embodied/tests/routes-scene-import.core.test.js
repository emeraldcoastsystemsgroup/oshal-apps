/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — BACKLOG B23: the Spaces-scan doorway over real loopback HTTP. A scene artifact is seeded into the handle relay the kernel's shared redeem dials, POST /world/scenes/import-artifact redeems it AS THE CALLER, registers it under scan:<scanId>, and the world resets onto it and explores it to DONE with the discovery code untouched. The refusals are proven one rule at a time: an unauthenticated caller, a ref that does not redeem, another owner's handle, the wrong MIME, bytes that are not JSON, an envelope with no scene, a scene whose shape is wrong, an extent below and above the engine's bounds, a solid count over the cap, and a scene that breaks this world's own rules — and after every one of them the owner's scenarios are exactly what they were, because nothing is registered on a refusal.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Renamed from routes-scene-import.test.js to the .core.test.js convention, so the manual framework-coupled gate discovers it; it needs a framework checkout and was run by no gate.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express. Run locally:
 * OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes-scene-import.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadRoutes, fakePool, artifactRelayDouble, PKG } = require('./routes.harness');
const { express, createEmbodiedRoutes, restore } = loadRoutes();

const SCENE_TYPE = 'application/vnd.oshal.embodied-scene+json';
const SECRET = 'test-service-secret-b23';
process.env.SWARM_SERVICE_SECRET = SECRET;

// ── One server: the package routes AND the kernel handle endpoints the shared redeem dials ──────
const pool = fakePool();
let wall = 1_000_000;
let currentSub = 'alice';
const relay = artifactRelayDouble(express, SECRET);
const app = express();
app.use(express.json());
app.use((req, _res, next) => { if (currentSub) req.oidc = { user: { sub: currentSub }, isAuthenticated: () => true }; next(); });
app.use('/api/artifacts', relay.router);
app.use('/api/embodied', createEmbodiedRoutes({ pool, appPackageDir: PKG }, { now: () => wall, noTimer: true }));
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}/api/embodied`; });
test.after(async () => { await new Promise((r) => server.close(r)); restore(); });

const call = async (p, init = {}) => {
  const res = await fetch(base + p, init);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: res.status, body };
};
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/**
 * A capture the way the Spaces converter emits one: a HOLLOW SHELL (a splat is a surface), so the
 * room's own walls and a freestanding block arrive as merged `fixture` boxes with nothing inside them,
 * no surfaces, no objects and no zones — the discovery has to find everything from the map.
 */
function scannedRoom(overrides = {}) {
  const room = { minX: 0, maxX: 4, minY: 0, maxY: 3.2, ceiling: 2.4, ...(overrides.room || {}) };
  const t = 0.1;
  const shell = [
    { name: 'scan-wall-w', kind: 'fixture', min: [room.minX, room.minY, 0], max: [room.minX + t, room.maxY, room.ceiling] },
    { name: 'scan-wall-e', kind: 'fixture', min: [room.maxX - t, room.minY, 0], max: [room.maxX, room.maxY, room.ceiling] },
    { name: 'scan-wall-s', kind: 'fixture', min: [room.minX, room.minY, 0], max: [room.maxX, room.minY + t, room.ceiling] },
    { name: 'scan-wall-n', kind: 'fixture', min: [room.minX, room.maxY - t, 0], max: [room.maxX, room.maxY, room.ceiling] },
    { name: 'scan-block-1', kind: 'fixture', min: [1.6, 1.3, 0], max: [2.4, 2.0, 0.85] },
    { name: 'scan-shelf-e', kind: 'fixture', min: [3.4, 0.8, 0.6], max: [3.9, 2.2, 0.75] },
  ];
  const scene = {
    name: 'spaces-scan',
    room,
    obstacles: overrides.obstacles || shell,
    surfaces: [], objects: [], zones: [], appliances: [],
    basePark: { x: 0.9, y: 0.6, yaw: Math.PI / 2 },
    droneHome: [0.6, 2.6, 0],
    ...(overrides.scene || {}),
  };
  return {
    scene,
    stats: { up: 'auto', scale: 1, unit: 'm', resolutionM: 0.05, boxes: scene.obstacles.length, floorClearanceM: 0.4 },
    scanId: overrides.scanId || 'scan0001',
    title: overrides.title || 'Back office',
  };
}

let refSeq = 0;
/** Seed one artifact handle the way the kernel's Send to… mints it, and return its ref. */
function seedArtifact(body, { type = SCENE_TYPE, sub = 'alice', name = 'scan.scene.json' } = {}) {
  refSeq += 1;
  const ref = `art_b23fixture${String(refSeq).padStart(4, '0')}`;
  relay.put(ref, { sub, type, name, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return ref;
}
const importRef = (ref) => call('/world/scenes/import-artifact', json('POST', { ref }));
const scenarioIds = async () => ((await call('/capabilities')).body.scenarios || []).map((s) => s.id);

/** Advance the injected wall clock through GET /state until the executor stops. */
async function tickSeconds(seconds) {
  let last = null;
  for (let i = 0; i < seconds / 2; i += 1) { wall += 2000; last = (await call('/state')).body; if (last.control.executor !== 'running' && i > 1) break; }
  return last;
}

test('the manifest declares the accepts destination this suite exercises', () => {
  const yaml = require('node:fs').readFileSync(require('node:path').join(PKG, 'oshal-app.yaml'), 'utf8');
  assert.match(yaml, /accepts:/, 'ADR-139 accepts block');
  assert.match(yaml, /types: \[application\/vnd\.oshal\.embodied-scene\+json\]/);
  assert.match(yaml, /endpoint: \/api\/embodied\/world\/scenes\/import-artifact/);
  assert.match(yaml, /mode: post/);
});

test('a redeemed Spaces scene registers as this owner\'s scenario and a world flies it to done', async () => {
  assert.deepEqual(await scenarioIds(), ['kitchen', 'studio'], 'the built-ins before any import');
  const imported = await importRef(seedArtifact(scannedRoom()));
  assert.equal(imported.status, 201, JSON.stringify(imported.body).slice(0, 300));
  assert.equal(imported.body.scenario, 'scan:scan0001');
  assert.equal(imported.body.name, 'Back office');
  assert.equal(imported.body.solids, 6);
  assert.equal(imported.body.stats.resolutionM, 0.05, 'the converter\'s decisions travel with it');

  const listed = (await call('/capabilities')).body.scenarios;
  assert.deepEqual(listed.map((s) => s.id), ['kitchen', 'studio', 'scan:scan0001'], 'imported scenes list AFTER the built-ins');
  const mine = listed[2];
  assert.equal(mine.source, 'scan'); assert.equal(mine.scanId, 'scan0001'); assert.equal(mine.solids, 6);

  const reset = await call('/world/reset', json('POST', { scenario: 'scan:scan0001', sensorSet: 'recon-3d' }));
  assert.equal(reset.status, 200, JSON.stringify(reset.body).slice(0, 300));
  assert.equal(reset.body.scenario, 'scan:scan0001', 'the world names the scene it was started from');
  assert.equal(reset.body.scene.name, 'scan:scan0001');

  const blind = (await call('/world')).body;
  assert.equal(blind.stats.scans, 0, 'the machine starts knowing nothing about the scanned room too');
  assert.deepEqual(blind.surfaces, []);

  const draft = await call('/tasks/draft', json('POST', { task: 'explore', maxScans: 12, droneFirst: true }));
  assert.equal(draft.status, 201, JSON.stringify(draft.body).slice(0, 300));
  assert.equal((await call(`/tasks/${draft.body.task_id}/execute`, json('POST', { confirm: true }))).status, 200);
  const final = await tickSeconds(900);
  assert.equal(final.control.executor, 'done', JSON.stringify(final.control).slice(0, 300));
  const world = (await call('/world')).body;
  assert.ok(world.stats.scans > 0, 'the drone scanned the scanned room');
  assert.ok(world.stats.knownFraction > 0.5, `known ${world.stats.knownFraction}`);
  assert.ok((await call('/world/voxels')).body.occupied.length > 0, 'the map carries the scan\'s solids');
});

test('a second import of the same scan replaces it, and another owner sees neither', async () => {
  currentSub = 'alice';
  const again = await importRef(seedArtifact(scannedRoom({ title: 'Back office (rescanned)' })));
  assert.equal(again.status, 201);
  const ids = await scenarioIds();
  assert.deepEqual(ids, ['kitchen', 'studio', 'scan:scan0001'], 'one row per scan, not two');
  assert.equal((await call('/capabilities')).body.scenarios[2].name, 'Back office (rescanned)');

  currentSub = 'mallory';
  assert.deepEqual(await scenarioIds(), ['kitchen', 'studio'], 'another owner never sees alice\'s scan');
  const stolen = await call('/world/reset', json('POST', { scenario: 'scan:scan0001' }));
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.error, 'unknown_scenario');
  currentSub = 'alice';
});

test('an unauthenticated caller cannot import a scene', async () => {
  currentSub = null;
  const res = await importRef(seedArtifact(scannedRoom({ scanId: 'anon0001' })));
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'not_authenticated');
  currentSub = 'alice';
  assert.ok(!(await scenarioIds()).includes('scan:anon0001'));
});

test('a ref that does not redeem is refused and registers nothing', async () => {
  const before = await scenarioIds();
  const malformed = await importRef('not-a-ref');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.rule, 'ref');

  const missing = await importRef('art_neverminted0001');
  assert.equal(missing.status, 404, JSON.stringify(missing.body));
  assert.match(missing.body.message, /not found/);

  // A handle minted for someone else: the relay is dialled AS THE CALLER, so it is a 404 to alice.
  const theirs = seedArtifact(scannedRoom({ scanId: 'bobscan1' }), { sub: 'bob' });
  const stolen = await importRef(theirs);
  assert.equal(stolen.status, 404);
  assert.deepEqual(await scenarioIds(), before, 'nothing was registered by any of them');
});

test('the wrong MIME is a 415 naming what this destination takes', async () => {
  const before = await scenarioIds();
  const res = await importRef(seedArtifact(scannedRoom({ scanId: 'wrongmime' }), { type: 'application/json' }));
  assert.equal(res.status, 415);
  assert.equal(res.body.rule, 'type');
  assert.equal(res.body.accepts, SCENE_TYPE);
  assert.match(res.body.message, /application\/json/);
  assert.deepEqual(await scenarioIds(), before);
});

test('a malformed scene is a 4xx naming the rule it broke, one rule at a time', async () => {
  const before = await scenarioIds();
  const cases = [
    ['malformed_json', 400, '{ this is not json'],
    ['envelope', 400, { stats: {}, scanId: 'x1', title: 'no scene here' }],
    ['scan_id', 400, { ...scannedRoom(), scanId: 'not a valid id!' }],
    ['scene_shape', 400, scannedRoom({ scene: { room: { minX: 0, maxX: 4, minY: 0 } } })],
    ['scene_shape', 400, scannedRoom({ scene: { obstacles: 'lots' } })],
    ['scene_shape', 400, scannedRoom({ scene: { droneHome: [0.6, 2.6] } })],
  ];
  for (const [rule, status, body] of cases) {
    const res = await importRef(seedArtifact(body));
    assert.equal(res.status, status, `${rule}: ${JSON.stringify(res.body).slice(0, 200)}`);
    assert.equal(res.body.error, 'scene_refused');
    assert.equal(res.body.rule, rule, JSON.stringify(res.body).slice(0, 200));
    assert.ok(res.body.message.length > 10, 'the refusal says what is wrong in words');
  }
  assert.deepEqual(await scenarioIds(), before, 'no half-imported world survived any of them');
});

test('a capture outside the engine\'s bounds is refused by the bound it broke', async () => {
  const before = await scenarioIds();
  const limits = (await call('/capabilities')).body.sceneImport.limits;
  assert.equal(limits.maxSolids, 2000);

  const flat = await importRef(seedArtifact(scannedRoom({ scanId: 'flat0001', room: { minX: 0, maxX: 0.8, minY: 0, maxY: 3.2, ceiling: 2.4 } })));
  assert.equal(flat.status, 422); assert.equal(flat.body.rule, 'extent');
  assert.match(flat.body.message, /at least 1\.5 m/);

  const huge = await importRef(seedArtifact(scannedRoom({ scanId: 'huge0001', room: { minX: 0, maxX: 26, minY: 0, maxY: 3.2, ceiling: 2.4 } })));
  assert.equal(huge.status, 422); assert.equal(huge.body.rule, 'extent');

  const low = await importRef(seedArtifact(scannedRoom({ scanId: 'low00001', room: { minX: 0, maxX: 4, minY: 0, maxY: 3.2, ceiling: 0.9 } })));
  assert.equal(low.status, 422); assert.equal(low.body.rule, 'ceiling');

  const cathedral = await importRef(seedArtifact(scannedRoom({ scanId: 'tall0001', room: { minX: 0, maxX: 4, minY: 0, maxY: 3.2, ceiling: 9 } })));
  assert.equal(cathedral.status, 422); assert.equal(cathedral.body.rule, 'ceiling');

  const volume = await importRef(seedArtifact(scannedRoom({ scanId: 'big00001', room: { minX: 0, maxX: 19, minY: 0, maxY: 19, ceiling: 3 } })));
  assert.equal(volume.status, 422); assert.equal(volume.body.rule, 'volume');

  const empty = await importRef(seedArtifact(scannedRoom({ scanId: 'empty001', obstacles: [] })));
  assert.equal(empty.status, 422); assert.equal(empty.body.rule, 'solids');
  assert.match(empty.body.message, /carved no solids/);

  const crumbs = Array.from({ length: 2100 }, (_, i) => ({
    name: `crumb-${i}`, kind: 'fixture',
    min: [0.5 + (i % 60) * 0.05, 0.5 + Math.floor(i / 60) * 0.05, 0],
    max: [0.52 + (i % 60) * 0.05, 0.52 + Math.floor(i / 60) * 0.05, 0.05],
  }));
  const dusty = await importRef(seedArtifact(scannedRoom({ scanId: 'dust0001', obstacles: crumbs })));
  assert.equal(dusty.status, 422); assert.equal(dusty.body.rule, 'solids');
  assert.match(dusty.body.message, /2100 solids/);

  assert.deepEqual(await scenarioIds(), before, 'not one out-of-bounds capture was registered');
});

test('a scene that breaks this world\'s own rules is refused with the issues it broke', async () => {
  const before = await scenarioIds();
  const outside = scannedRoom({ scanId: 'rules001' });
  outside.scene.obstacles = [...outside.scene.obstacles, { name: 'scan-strays', kind: 'fixture', min: [3.9, 1, 0], max: [5.5, 1.5, 1] }];
  const res = await importRef(seedArtifact(outside));
  assert.equal(res.status, 422);
  assert.equal(res.body.rule, 'scene_rules');
  assert.ok(res.body.issues.length >= 1, 'the issues validateScene found travel with the refusal');
  assert.match(res.body.issues[0], /leaves the room/);

  const padInside = scannedRoom({ scanId: 'rules002' });
  padInside.scene.droneHome = [2.0, 1.6, 0]; // the middle of scan-block-1
  const res2 = await importRef(seedArtifact(padInside));
  assert.equal(res2.status, 422);
  assert.equal(res2.body.rule, 'scene_rules');
  assert.match(res2.body.issues.join(' '), /drone pad/);

  assert.deepEqual(await scenarioIds(), before, 'a scene that breaks the rules never becomes a scenario');
});
