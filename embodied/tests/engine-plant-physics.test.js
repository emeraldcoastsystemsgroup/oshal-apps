/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The plant ops are serialized: two routes called together reach the engine one after the other (the bridge refuses a second request as busy; found by the real-engine proof when the page read the state and the jobs together).
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D9, lane @ds-plant: the generic plant's routes against the COMPILED modules with a fake bridge answering in the engine's REAL reply shapes (recorded from engine/tests/test_plant_reach.py on MuJoCo 3.3.5). The load route names the session per owner and product and fills the medium from the air row (never a literal); the state route answers 404 plant_not_built on the engine's no_session; train with 0 steps answers the baseline report now and with steps starts a job; the jobs listing carries the default length; certify sends the file (and the spec when given), remembers the certificate for the owner with kind plant, refuses a pathed or non-plant name before the engine, and answers the gate's named refusals with their status; the drive catalog publishes the owned servo row's stall, no-load speed and continuous rating as servos.ts computes them and says a propulsion row cannot drive a joint; the TypeScript runtime-file list equals the bridge's RUNTIME_FILES tuple (the mismatch the spider lane caught only on the live box).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routes = require(path.join(__dirname, '..', 'routes', 'embodied-plant-routes.js'));
const { EngineFailure } = require(path.join(__dirname, '..', 'routes', 'engine', 'physics', 'bridge-client.js'));
const { ENGINE_RUNTIME_FILES, engineBuildHash } = require(path.join(__dirname, '..', 'routes', 'engine', 'physics', 'build-hash.js'));
const { mediumById } = require(path.join(__dirname, '..', 'routes', 'engine', 'medium', 'medium.js'));
const { servoRow } = require(path.join(__dirname, '..', 'routes', 'engine', 'design', 'parts-catalog.js'));
const { servoSpecFrom, CONTINUOUS_FRACTION } = require(path.join(__dirname, '..', 'routes', 'engine', 'design', 'servos.js'));

const ENGINE = path.join(__dirname, '..', 'engine');
const SPEC = JSON.parse(fs.readFileSync(path.join(ENGINE, 'tests', 'fixtures', 'lift-1-spec.json'), 'utf8'));
const TASK = JSON.parse(fs.readFileSync(path.join(ENGINE, 'tests', 'fixtures', 'lift-1-task.json'), 'utf8'));
const PROJECT = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
/** The engine's replies as recorded on the real plant. */
const LOAD = { name: PROJECT, specSha256: '23b5d90cfc92583cdd8be04776cd94ddcb1ee5cfb5f6c490ff9c8aad040d4485', timestepS: 0.002, controlDtS: 0.02, bodies: 5, geoms: 5, massKg: 3.528, medium: { id: 'air', gravityMps2: [0, 0, -9.81] },
  parts: [{ id: 'base', name: 'Base plate', massKg: 0.496, extentsM: [0.2, 0.2, 0.01], mesh: false }], joints: [{ id: 'carriage-slide', type: 'slide', parent: 'column', child: 'carriage', axis: [0, 0, 1], range: [0, 0.35], originM: [0, 0, 0] }],
  actuators: [{ joint: 'carriage-slide', type: 'slide', stallNm: 2.942, noLoadRadS: 4.7166, gearRatio: 40, continuousNm: 1.471, row: { id: 'sts3215-12v', source: 'embodied' }, forceLimit: 117.68, noLoadSpeed: 0.117915, kp: 2353.6, damping: 998.007, unit: 'N', speedUnit: 'm/s', range: [0, 0.35] }],
  payload: { massKg: 2, attachedTo: 'carriage', atM: [0, 0, 0.04], restPosM: [0, 0, 0.128106] }, senses: [{ name: 'joints', present: true, count: 1 }], controller: 'targets' };
const STATE = { timeS: 0, jointPos: [0], jointVel: [0], jointForce: [0], motorTorqueNm: [0], targets: [0], gyroRadS: [0, 0, 0], accelMps2: [0, 0, 9.81], payloadPosM: [0, 0, 0.128106], payloadVelMps: [0, 0, 0], energyJ: 0, info: LOAD };
const BASELINE = { episodes: 5, meanReturn: 91.47, reached: 5, reachedS: 3.58, finalErrorM: 0, rmsTorqueMaxNm: 0.549, rmsTorqueMaxActuator: 'carriage-slide', peakTorqueNm: 1.4151, overRatingSteps: 0, energyJ: 33.37 };
const REPORT = { task: 'plant-reach', project: PROJECT, seed: 0, specSha256: LOAD.specSha256, taskSpec: { targetPosM: [0, 0, 0.428106], deltaM: [0, 0, 0.3], timeS: 5, loadKg: 2 }, timesteps: 0, evalSeeds: [100, 101, 102, 103, 104], baseline: BASELINE };
const JOB = { started: true, file: `plant-${PROJECT}-reach-seed0.json`, policyFile: null, project: PROJECT, seed: 0, timesteps: 2048, state: 'running', startedAt: '2026-10-30T23:25:28Z', elapsedS: 0, stepsDone: 0, error: null };
const CERT = { task: 'plant-certify', project: PROJECT, seed: 0, reportFile: `plant-${PROJECT}-reach-seed0.json`, policyFile: `plant-${PROJECT}-reach-ppo-seed0.zip`, policySha256: 'a'.repeat(64), buildHash: 'b'.repeat(64), specSha256: LOAD.specSha256, evalSeeds: [100, 101, 102, 103, 104],
  limits: [{ joint: 'carriage-slide', continuousNm: 1.471, stallNm: 2.942, gearRatio: 40 }], reachedWithinS: 5, unit: 'control steps', checked: 1875, refused: [], refusedCount: 0, ok: true, baseline: BASELINE, policy: { ...BASELINE, reachedS: 4.34, finalErrorM: 0.0045 }, verdict: { reached: true, reachedS: false, finalErrorM: false, rmsTorqueMaxNm: true }, policyBeatsBaseline: false, certifiedAt: '2026-10-30T23:25:45Z', wallSeconds: 3.55 };

function fakeRouter() {
  const handlers = {};
  return { handlers, get: (p, h) => { handlers[`GET ${p}`] = h; }, post: (p, h) => { handlers[`POST ${p}`] = h; } };
}
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
/** Mount with a fake engine: `answer(op, payload)` returns the reply or throws an EngineFailure. */
function mount(answer, sub = 'operator') {
  const router = fakeRouter();
  const calls = []; const remembered = [];
  routes.registerPlantPhysicsRoutes(router, {
    withSub: () => sub,
    plantOp: async (op, payload, timeoutMs) => { calls.push({ op, payload, timeoutMs }); return answer(op, payload); },
    rememberCertified: (who, policyFile, certificate) => { remembered.push({ who, policyFile, ok: certificate.ok }); },
    physicsFailure: (error) => ({ status: 503, body: { error: 'physics_unavailable', code: error.code, reason: error.reason ?? null, installHint: 'install-engine.sh' } }),
  });
  return { router, calls, remembered };
}
const refusing = (code) => () => { throw new EngineFailure('engine_error', `physics engine failed`, `because ${code}`, code); };
const down = () => { throw new EngineFailure('capability_unavailable', 'the physics engine is unavailable', 'connect ECONNREFUSED'); };

test('the TypeScript runtime-file list equals the bridge\'s RUNTIME_FILES tuple, so the api and the container hash the same tree', () => {
  const src = fs.readFileSync(path.join(ENGINE, 'container', 'embodied_engine_bridge.py'), 'utf8');
  const tuple = /RUNTIME_FILES = \(([\s\S]*?)\)\n/.exec(src)[1];
  const python = [...tuple.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...ENGINE_RUNTIME_FILES], python);
  assert.ok(python.includes('embodied_plant.py') && python.includes('tasks/plant_reach.py'), 'the generic plant and its task are runtime files: a certificate binds to the code that replays it');
  assert.match(engineBuildHash(ENGINE), /^[0-9a-f]{64}$/);
});

test('POST /physics/plant/load names the session per owner and product, fills the medium from the air row and answers the engine\'s load reply', async () => {
  const { router, calls } = mount((op) => (op === 'plant.load' ? LOAD : {}));
  const res = fakeRes();
  await router.handlers['POST /physics/plant/load']({ body: { project: PROJECT, spec: SPEC } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { built: true, project: PROJECT, route: '/api/embodied/physics/plant', plant: LOAD });
  assert.equal(calls.length, 1); assert.equal(calls[0].op, 'plant.load'); assert.equal(calls[0].timeoutMs, routes.PLANT_LOAD_TIMEOUT_MS);
  assert.equal(calls[0].payload.session, `plant:${PROJECT}:operator`); assert.equal(calls[0].payload.spec.name, PROJECT);
  assert.deepEqual(calls[0].payload.spec.medium, { id: 'air', gravityMps2: mediumById('air').gravityMps2 }, 'the medium is the air row\'s, not a number in the route');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src-routes', 'embodied-plant-routes.ts'), 'utf8');
  assert.ok(!/9\.8\d*/.test(source), 'no gravity typed in the routes');
  assert.equal(routes.plantSession('a', 'p'), 'plant:p:a');
  assert.deepEqual(routes.engineSpec('x', { parts: [], medium: { id: 'vacuum', gravityMps2: [0, 0, -1] } }).medium, { id: 'vacuum', gravityMps2: [0, 0, -1] }, 'a stated medium is kept');
  for (const [body, error] of [[{ spec: SPEC }, 'bad_project'], [{ project: '../x', spec: SPEC }, 'bad_project'], [{ project: PROJECT }, 'bad_spec'], [{ project: PROJECT, spec: { parts: [] } }, 'bad_spec']]) {
    const r = fakeRes(); await router.handlers['POST /physics/plant/load']({ body }, r);
    assert.equal(r.statusCode, 400, JSON.stringify(body)); assert.equal(r.body.error, error);
  }
  assert.equal(calls.length, 1, 'a refused body never reaches the engine');
});

test('GET /physics/plant/state reads the owner\'s plant and answers 404 plant_not_built on the engine\'s no_session; a bad spec from the engine is 400 by name, a cycle 422', async () => {
  const { router } = mount((op) => (op === 'plant.state' ? STATE : {}));
  let res = fakeRes(); await router.handlers['GET /physics/plant/state']({ query: { project: PROJECT } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.deepEqual(res.body, { built: true, project: PROJECT, route: '/api/embodied/physics/plant', state: STATE });
  res = fakeRes(); await router.handlers['GET /physics/plant/state']({ query: {} }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'bad_project');
  const none = mount(refusing('no_session'));
  res = fakeRes(); await none.router.handlers['GET /physics/plant/state']({ query: { project: PROJECT } }, res);
  assert.equal(res.statusCode, 404); assert.equal(res.body.error, 'plant_not_built'); assert.equal(res.body.built, false);
  for (const [code, status] of [['bad_spec', 400], ['unknown_part', 400], ['cycle', 422], ['no_payload', 422]]) {
    const bad = mount(refusing(code));
    res = fakeRes(); await bad.router.handlers['POST /physics/plant/load']({ body: { project: PROJECT, spec: SPEC } }, res);
    assert.equal(res.statusCode, status, code); assert.equal(res.body.error, code); assert.equal(res.body.message, `because ${code}`); assert.equal(res.body.project, PROJECT);
  }
  const dead = mount(down);
  res = fakeRes(); await dead.router.handlers['POST /physics/plant/load']({ body: { project: PROJECT, spec: SPEC } }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'physics_unavailable'); assert.equal(res.body.code, 'capability_unavailable'); assert.ok(res.body.installHint);
});

test('POST /physics/plant/train with 0 steps answers the baseline report now, with steps starts a job; GET lists the jobs with the default length', async () => {
  const { router, calls } = mount((op) => (op === 'plant.train' ? REPORT : op === 'plant.jobs' ? { jobs: [JOB] } : {}));
  let res = fakeRes(); await router.handlers['POST /physics/plant/train']({ body: { project: PROJECT, spec: SPEC, task: TASK } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { started: false, project: PROJECT, report: REPORT });
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['project', 'seed', 'spec', 'task', 'timesteps']); assert.equal(calls[0].payload.timesteps, 0); assert.equal(calls[0].payload.seed, 0);
  assert.deepEqual(calls[0].payload.task, TASK); assert.equal(calls[0].payload.spec.medium.id, 'air'); assert.equal(calls[0].timeoutMs, routes.PLANT_TRAIN_TIMEOUT_MS);
  const jobs = mount((op) => (op === 'plant.train' ? JOB : {}));
  res = fakeRes(); await jobs.router.handlers['POST /physics/plant/train']({ body: { project: PROJECT, spec: SPEC, task: TASK, timesteps: 2048, seed: 0, seeds: [100, 101] } }, res);
  assert.deepEqual(res.body, { started: true, project: PROJECT, job: JOB }); assert.deepEqual(jobs.calls[0].payload.seeds, [100, 101]); assert.equal(jobs.calls[0].payload.timesteps, 2048);
  res = fakeRes(); await router.handlers['GET /physics/plant/train']({ query: {} }, res);
  assert.deepEqual(res.body, { jobs: [JOB], defaults: { timesteps: routes.PLANT_TRAIN_DEFAULT_TIMESTEPS, maxTimesteps: routes.PLANT_TRAIN_MAX_TIMESTEPS } });
  assert.ok(routes.PLANT_TRAIN_DEFAULT_TIMESTEPS > 0 && routes.PLANT_TRAIN_DEFAULT_TIMESTEPS <= routes.PLANT_TRAIN_MAX_TIMESTEPS);
  for (const [body, error] of [[{ spec: SPEC, task: TASK }, 'bad_project'], [{ project: PROJECT, task: TASK }, 'bad_spec'], [{ project: PROJECT, spec: SPEC }, 'bad_task'], [{ project: PROJECT, spec: SPEC, task: TASK, timesteps: -1 }, 'bad_timesteps'], [{ project: PROJECT, spec: SPEC, task: TASK, timesteps: routes.PLANT_TRAIN_MAX_TIMESTEPS + 1 }, 'bad_timesteps'], [{ project: PROJECT, spec: SPEC, task: TASK, timesteps: 1.5 }, 'bad_timesteps'], [{ project: PROJECT, spec: SPEC, task: TASK, seed: -2 }, 'bad_seed']]) {
    res = fakeRes(); await router.handlers['POST /physics/plant/train']({ body }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body)); assert.equal(res.body.error, error);
  }
  const busy = mount(refusing('busy'));
  res = fakeRes(); await busy.router.handlers['POST /physics/plant/train']({ body: { project: PROJECT, spec: SPEC, task: TASK, timesteps: 10 } }, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'busy');
  const badTask = mount(refusing('bad_task'));
  res = fakeRes(); await badTask.router.handlers['POST /physics/plant/train']({ body: { project: PROJECT, spec: SPEC, task: { timeS: 0 } } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'bad_task');
});

test('POST /physics/plant/certify sends the file and the spec to the gate, remembers the certificate for the owner, refuses a pathed or non-plant name before the engine, and answers the gate\'s named refusals', async () => {
  const { router, calls, remembered } = mount((op) => (op === 'plant.certify' ? CERT : {}));
  let res = fakeRes(); await router.handlers['POST /physics/plant/certify']({ body: { file: ` ${CERT.reportFile} `, project: PROJECT, spec: SPEC } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { file: CERT.reportFile, policyFile: CERT.policyFile, beatsBaseline: false, limits: CERT.limits, certification: CERT });
  assert.equal(calls[0].payload.file, CERT.reportFile); assert.equal(calls[0].payload.spec.name, PROJECT); assert.equal(calls[0].payload.spec.medium.id, 'air'); assert.equal(calls[0].timeoutMs, routes.PLANT_CERTIFY_TIMEOUT_MS);
  assert.deepEqual(remembered, [{ who: 'operator', policyFile: CERT.policyFile, ok: true }]);
  res = fakeRes(); await router.handlers['POST /physics/plant/certify']({ body: { file: CERT.reportFile } }, res);
  assert.equal(calls[1].payload.spec, undefined, 'no spec given, none sent: the gate replays the report\'s own');
  for (const [body, error] of [[{}, 'file_required'], [{ file: '../plant-x-reach-seed0.json' }, 'bad_file'], [{ file: 'hexapod-walk-shape-seed1.json' }, 'bad_file']]) {
    res = fakeRes(); await router.handlers['POST /physics/plant/certify']({ body }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body)); assert.equal(res.body.error, error);
  }
  assert.equal(calls.length, 2, 'a refused name never reaches the engine');
  for (const [code, status] of [['report_not_found', 404], ['policy_not_found', 404], ['no_policy', 422], ['bad_task', 400], ['spec_mismatch', 422], ['mesh_missing', 422]]) {
    const r = mount(refusing(code));
    res = fakeRes(); await r.router.handlers['POST /physics/plant/certify']({ body: { file: CERT.reportFile } }, res);
    assert.equal(res.statusCode, status, code); assert.equal(res.body.error, code); assert.equal(res.body.file, CERT.reportFile); assert.equal(r.remembered.length, 0);
  }
  const dead = mount(down);
  res = fakeRes(); await dead.router.handlers['POST /physics/plant/certify']({ body: { file: CERT.reportFile } }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'physics_unavailable');
});

test('GET /build/catalog publishes the owned servo row\'s stall, no-load speed and continuous rating as the joint sizing computes them; a propulsion row cannot drive a joint', async () => {
  const { router } = mount(() => ({}));
  const res = fakeRes(); router.handlers['GET /build/catalog']({ query: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Cache-Control'], 'no-store');
  const c = res.body;
  const sts = c.servos.find((r) => r.id === 'sts3215-12v');
  const spec = servoSpecFrom(servoRow('sts3215-12v'));
  assert.equal(sts.stallNm, spec.stallNm); assert.equal(sts.noLoadRadS, spec.noLoadRadS); assert.equal(sts.continuousNm, spec.stallNm * CONTINUOUS_FRACTION); assert.equal(c.continuousFraction, CONTINUOUS_FRACTION);
  assert.ok(Math.abs(sts.noLoadRpm - spec.noLoadRadS * 60 / (2 * Math.PI)) < 1e-9); assert.equal(sts.massG, spec.massG); assert.equal(sts.kind, 'bus-servo'); assert.ok(sts.source.length > 20);
  assert.ok(c.motors.length >= 2 && c.motors.every((m) => m.stallNm === null && m.continuousNm === null && typeof m.kv === 'number' && /cannot drive a joint/.test(m.note)));
  assert.deepEqual(routes.driveCatalog().servos.map((s) => s.id), c.servos.map((s) => s.id));
  const unauth = fakeRouter(); routes.registerPlantPhysicsRoutes(unauth, { withSub: (_req, r) => { r.status(401).json({ error: 'unauthenticated' }); return null; }, plantOp: async () => ({}), physicsFailure: () => ({ status: 503, body: {} }) });
  const r2 = fakeRes(); unauth.handlers['GET /build/catalog']({ query: {} }, r2); assert.equal(r2.statusCode, 401);
});

test('the plant ops are serialized: two routes called together reach the engine one after the other, and a failure does not block the next', async () => {
  const order = []; let inFlight = 0; let overlap = 0;
  const { router } = mount(async (op) => { inFlight += 1; overlap = Math.max(overlap, inFlight); order.push(`start ${op}`); await new Promise((r) => setTimeout(r, 20)); inFlight -= 1; order.push(`end ${op}`); if (op === 'plant.jobs') throw new EngineFailure('engine_error', 'x', 'y', 'no_session'); return op === 'plant.state' ? STATE : LOAD; });
  const a = fakeRes(); const b = fakeRes(); const c = fakeRes();
  await Promise.all([router.handlers['GET /physics/plant/state']({ query: { project: PROJECT } }, a), router.handlers['GET /physics/plant/train']({ query: {} }, b), router.handlers['POST /physics/plant/load']({ body: { project: PROJECT, spec: SPEC } }, c)]);
  assert.equal(overlap, 1, 'never two requests on the bridge at once');
  assert.deepEqual(order, ['start plant.state', 'end plant.state', 'start plant.jobs', 'end plant.jobs', 'start plant.load', 'end plant.load']);
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 404, 'the refusal answers its own route'); assert.equal(c.statusCode, 200, 'and the next request still runs');
  const direct = routes.serialized(async (op) => op); assert.equal(await direct('plant.state', {}, 1), 'plant.state');
});
