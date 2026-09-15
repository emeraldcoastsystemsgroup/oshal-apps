/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The discovered world through the API: /world starts empty, the explore task maps it, /world/voxels and /picture serve the 3-D view, labels attach to discovered ids, clear-surface takes discovered ids, and every scripted flow explores first.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express resolved from the framework checkout (OSHAL_CORE_DIR): the surface and asset serve, capabilities publish validated manifests, the caller gate 401s, tasks are owner-scoped (a second subject gets 404), draft stores a plan with a passing rehearsal, execute needs confirm:true (428), runs after a fresh rehearsal, and — with an injected clock driven through GET /state — reaches status done with every dish on the rack and the log carrying every step; take/release pause and resume; a refused manual command is a 409 AND a refused log row; e-stop latches (reset lifts it); world reset is refused mid-run. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express. Not part of the store-CI wildcard; run
 * locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | A drone-first explore draft over the API: no base sweep in the plan; the state carries the drone localisation and a sim-only true pose.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Sensor sets over the API: listed in capabilities, chosen on world reset, unknown ids refused.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | The drone designer over the API: the design, a part with its CAD Studio body, the markdown tables.
 * 6   | maintainer@emeraldcoastsystemsgroup.com     | The framework doubles and the in-memory pool moved to routes.harness.js, shared with the browser proof.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | B20: a node that joined the rail by heartbeat flies an owner's world (the node double heartbeats the package's engine tree hash), belongs to the owner its heartbeats carried (another owner sees no node, 404), goes offline on silence (503 node_offline), and the manifest's service-secret posture for the nodes mount is pinned.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | B4: capabilities list the scenarios; a reset chooses one; an unknown scene is 400.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | The printed arm's routes (ADR-152 D5 task 3): the design, a part as a CAD Studio program, the document, the model, and the check — measured in the container, refused honestly when it is not there.
 * 10 | maintainer@emeraldcoastsystemsgroup.com   | ADR-160 S1 over the API: /physics/media publishes the three medium records and both force models' declared envelopes; /physics/hull drops the explorer hull in air with the fall the plant reproduces AND the flotation question refused by name in the same answer; seawater is 422 carrying model_not_valid_in_medium; a medium this lab does not implement is 400 unknown_medium and is never substituted; the caller gate 401s on all three.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadRoutes, fakePool } = require('./routes.harness');
const { express, createEmbodiedRoutes, NODE_MANIFESTS, restore } = loadRoutes();
const { PKG } = require('./routes.harness');

// ── Test server with an injected clock ───────────────────────────────────────
const pool = fakePool();
let wall = 1_000_000;
let currentSub = 'alice';
const app = express();
app.use(express.json());
app.use((req, _res, next) => { if (currentSub) req.oidc = { user: { sub: currentSub }, isAuthenticated: () => true }; next(); });
app.use('/api/embodied', createEmbodiedRoutes({ pool, appPackageDir: PKG }, { now: () => wall, noTimer: true }));
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}/api/embodied`; });
test.after(async () => { await new Promise((r) => server.close(r)); restore(); });

const call = async (p, init = {}) => {
  const res = await fetch(base + p, init);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: res.status, body, headers: res.headers, text };
};
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
/** Advance the injected wall clock and poll state once (the world advances ≤ 2 s per read). */
async function tickSeconds(seconds) {
  let last = null;
  for (let i = 0; i < seconds / 2; i += 1) { wall += 2000; last = (await call('/state')).body; if (last.control.executor !== 'running' && i > 1) break; }
  return last;
}

test('capabilities list the drone sensor sets and a world reset can choose the printed drone', async () => {
  const caps = (await call('/capabilities')).body;
  assert.deepEqual(caps.sensorSets.map((x) => x.id).sort(), ['recon-3d', 'recon-mini']);
  assert.deepEqual(caps.scenarios.map((x) => x.id), ['kitchen', 'studio'], 'B4: the named hidden scenes');
  const bad = await call('/world/reset', json('POST', { sensorSet: 'nonsense' }));
  assert.equal(bad.status, 400);
  const mini = await call('/world/reset', json('POST', { sensorSet: 'recon-mini' }));
  assert.equal(mini.status, 200, JSON.stringify(mini.body).slice(0, 200));
  assert.equal(mini.body.drone.sensorSet, 'recon-mini');
  const studio = await call('/world/reset', json('POST', { scenario: 'studio', sensorSet: 'recon-3d' }));
  assert.equal(studio.status, 200, JSON.stringify(studio.body).slice(0, 200));
  assert.equal(studio.body.scenario, 'studio'); assert.equal(studio.body.scene.name, 'studio');
  assert.equal((await call('/world/reset', json('POST', { scenario: 'attic' }))).status, 400, 'an unknown scene is refused');
  const back = await call('/world/reset', json('POST', { sensorSet: 'recon-3d' }));
  assert.equal(back.body.drone.sensorSet, 'recon-3d', 'back to the default for the rest of the suite');
});

test('surface, asset and capabilities serve; the caller gate answers 401', async () => {
  const page = await call('/app');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('<title>Embodied Swarm</title>'));
  assert.ok(page.text.includes('/api/embodied/assets/embodied.js'));
  const js = await call('/assets/embodied.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const caps = await call('/capabilities');
  assert.equal(caps.body.simulated, true);
  assert.deepEqual(caps.body.nodes.map((n) => n.nodeId), NODE_MANIFESTS.map((n) => n.nodeId));
  assert.deepEqual(caps.body.tasks, ['explore', 'clear-surface', 'fetch-from-appliance']);
  currentSub = null;
  for (const p of ['/state', '/tasks', '/log', '/camera']) assert.equal((await call(p)).status, 401, p);
  assert.equal((await call('/control/take', json('POST', {}))).status, 401);
  currentSub = 'alice';
});

let taskId;
let basinId; let counterId;
/** Explore through the API: draft, confirm-execute, tick to done, then read the discovered world. */
async function exploreViaApi() {
  const d = await call('/tasks/draft', json('POST', { task: 'explore', maxScans: 12 }));
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal((await call(`/tasks/${d.body.task_id}/execute`, json('POST', { confirm: true }))).status, 200);
  const final = await tickSeconds(600);
  assert.equal(final.control.executor, 'done', JSON.stringify(final.control));
  const world = (await call('/world')).body;
  assert.ok(world.stats.knownFraction > 0.8, `known ${world.stats.knownFraction}`);
  const basin = world.surfaces.filter((s) => Math.abs(s.z - 0.72) < 0.03).sort((a, b) => b.areaM2 - a.areaM2)[0];
  const counter = world.surfaces.filter((s) => Math.abs(s.z - 0.9) < 0.03).sort((a, b) => b.areaM2 - a.areaM2)[0];
  assert.ok(basin && counter, 'the basin and a counter are discovered');
  return { basinId: basin.id, counterId: counter.id, world };
}

test('the world starts unknown; exploring through the API maps it and discovers the basin and the dishes', async () => {
  const blind = (await call('/world')).body;
  assert.equal(blind.stats.scans, 0);
  assert.deepEqual(blind.surfaces, []);
  const voxels = await call('/world/voxels');
  assert.equal(voxels.body.occupied.length, 0);
  ({ basinId, counterId } = await exploreViaApi());
  const world = (await call('/world')).body;
  assert.ok(world.objects.filter((o) => o.surfaceId === basinId && o.guess === 'plate').length >= 2, 'both plates discovered on the basin');
  const pic = await call('/picture?sensor=drone');
  assert.equal(pic.body.simulated, true); assert.equal(pic.body.width, 160);
  assert.ok(typeof pic.body.rgb === 'string' && pic.body.rgb.length > 1000);
  assert.equal((await call('/picture?sensor=xray')).status, 400);
  const label = await call('/world/label', json('POST', { id: basinId, label: 'sink' }));
  assert.equal(label.status, 200);
  assert.equal((await call('/world')).body.surfaces.find((s) => s.id === basinId).label, 'sink');
  assert.equal((await call('/world/label', json('POST', { id: 'surf-999', label: 'x' }))).status, 404);
  assert.ok((await call('/world/voxels')).body.occupied.length > 1000);
});

test('a draft stores the plan with a passing rehearsal and is owner-scoped', async () => {
  const r = await call('/tasks/draft', json('POST', { task: 'clear-surface', from: basinId, to: counterId }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  taskId = r.body.task_id;
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.rehearsal.ok, true, JSON.stringify(r.body.rehearsal.issues));
  assert.ok(r.body.plan.steps.length > 30);
  assert.ok(r.body.plan.steps.some((s) => s.kind === 'wrist.scan'));
  assert.equal((await call('/tasks')).body.length, 2);
  assert.equal((await call(`/tasks/${taskId}`)).status, 200);
  currentSub = 'bob';
  assert.equal((await call(`/tasks/${taskId}`)).status, 404, 'another owner cannot see the task');
  assert.equal((await call('/tasks')).body.length, 0);
  assert.deepEqual((await call('/world')).body.surfaces, [], "another owner's world is their own, and unexplored");
  currentSub = 'alice';
  const bad = await call('/tasks/draft', json('POST', { task: 'clear-surface', from: counterId, to: basinId }));
  assert.equal(bad.status, 422);
  assert.match(bad.body.message, /nothing discovered/);
  assert.equal((await call('/tasks/draft', json('POST', { task: 'clear-surface', from: 'surf-999', to: counterId }))).status, 422);
  assert.equal((await call('/tasks/draft', json('POST', { task: 'fold-laundry' }))).status, 400);
  const fetchDraft = await call('/tasks/draft', json('POST', { task: 'fetch-from-appliance', appliance: 'fridge', object: 'milk-1', to: 'island' }));
  assert.equal(fetchDraft.status, 201, JSON.stringify(fetchDraft.body));
  assert.equal(fetchDraft.body.rehearsal.ok, true, JSON.stringify(fetchDraft.body.rehearsal.issues));
  assert.ok(fetchDraft.body.plan.steps.some((s) => s.kind === 'arm.grasp-handle'));
  const caps = await call('/capabilities');
  assert.deepEqual(caps.body.tasks, ['explore', 'clear-surface', 'fetch-from-appliance']);
  assert.ok(caps.body.appliances.some((a) => a.id === 'fridge' && a.hasDoor));
});

// The counter-right top carries the declared rack zone: a plate set down inside the zone rests on
// 'rack', outside it on the bare top. Both are the counter the machine discovered.
const ON_COUNTER_RIGHT = new Set(['rack', 'top:counter-right']);

test('a drone-first explore draft parks the rover and the state reports the drone localisation', async () => {
  const d = await call('/tasks/draft', json('POST', { task: 'explore', maxScans: 6, droneFirst: true }));
  assert.equal(d.status, 201, JSON.stringify(d.body).slice(0, 300));
  const plan = d.body.plan || (d.body.task && d.body.task.plan);
  assert.ok(plan, 'the draft returns its plan');
  assert.ok(!plan.steps.some((s) => s.kind === 'rover.scan'), 'no base sweep in a drone-first plan');
  assert.match(plan.title, /drone first/);
  const st = (await call('/state')).body;
  assert.ok(['anchored', 'tracking', 'lost'].includes(st.drone.localization.status), JSON.stringify(st.drone.localization));
  assert.equal(st.drone.truth.simOnly, true, 'the true pose is labelled sim-only');
});

test('the drone designer serves the design, a part with its CAD Studio body, and the design as markdown', async () => {
  const d = await call('/build/drone?fit=recon-mini');
  assert.equal(d.status, 200);
  assert.equal(d.body.fit.id, 'recon-mini');
  assert.ok(d.body.parts.length >= 8 && d.body.massBudget.allUpG > 600);
  assert.equal(d.body.sizing.auwG, d.body.massBudget.allUpG, 'sized at the summed budget');
  const bad = await call('/build/drone?fit=nonsense');
  assert.equal(bad.status, 400);
  const part = await call('/build/drone/parts/centre-plate?fit=recon-3d');
  assert.equal(part.status, 200);
  assert.equal(part.body.cadStudio.base.kind, 'box');
  assert.ok(Array.isArray(part.body.cadStudio.features) && part.body.cadStudio.features.length > 10);
  assert.equal(part.body.cadStudio.source.package, 'embodied');
  assert.equal((await call('/build/drone/parts/nope')).status, 404);
  const md = await call('/build/drone/design.md?fit=recon-mini');
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-type') || '', /text\/markdown/);
  assert.match(md.text, /## Mass budget/);
});

test('execute needs confirm, then runs after a fresh rehearsal to done with every dish on the rack and every step logged', async () => {
  const unconfirmed = await call(`/tasks/${taskId}/execute`, json('POST', {}));
  assert.equal(unconfirmed.status, 428);
  assert.equal(pool.tasks.find((t) => t.task_id === taskId).status, 'draft', 'no status change without confirm');
  const go = await call(`/tasks/${taskId}/execute`, json('POST', { confirm: true }));
  assert.equal(go.status, 200, JSON.stringify(go.body));
  assert.equal(go.body.control.mode, 'auto');
  assert.equal(pool.tasks.find((t) => t.task_id === taskId).status, 'executing');
  assert.equal((await call('/world/reset', json('POST', {}))).status, 409, 'reset is refused mid-run');
  assert.equal((await call(`/tasks/${taskId}/execute`, json('POST', { confirm: true }))).status, 409, 'a task executes once');
  const final = await tickSeconds(600);
  assert.equal(final.control.executor, 'done', JSON.stringify(final.control));
  assert.equal(final.control.mode, 'idle');
  for (const id of ['plate-1', 'plate-2']) assert.ok(ON_COUNTER_RIGHT.has(final.objects.find((o) => o.id === id).location.surfaceId), `${id} on the counter the machine found`);
  assert.equal(pool.tasks.find((t) => t.task_id === taskId).status, 'done');
  const logRows = (await call('/log?limit=500')).body;
  const plan = pool.tasks.find((t) => t.task_id === taskId).plan;
  for (const step of plan.steps) assert.ok(logRows.some((r) => r.actor === `plan:${step.id}` && r.outcome === 'completed' && r.task_id === taskId), `${step.id} completed in the log`);
  assert.equal(logRows.filter((r) => r.outcome === 'refused').length, 0);
  const camera = await call('/camera');
  assert.equal(camera.body.simulated, true);
  assert.ok(Array.isArray(camera.body.detections));
});

test('take pauses a running plan, a refused manual command is 409 and logged, release resumes to completion', async () => {
  await call('/world/reset', json('POST', {}));
  const ids = await exploreViaApi();
  const d = await call('/tasks/draft', json('POST', { task: 'clear-surface', from: ids.basinId, to: ids.counterId }));
  const id = d.body.task_id;
  assert.equal((await call(`/tasks/${id}/execute`, json('POST', { confirm: true }))).status, 200);
  await tickSeconds(20);
  const took = await call('/control/take', json('POST', {}));
  assert.equal(took.status, 200);
  assert.equal(took.body.control.mode, 'manual');
  assert.equal(took.body.control.executor, 'paused');
  const refused = await call('/control/command', json('POST', { nodeId: 'rover-arm-1', command: 'jog', params: { v: 9, w: 0, seconds: 99 } }));
  assert.ok(refused.status === 200 || refused.status === 409, 'a clamped jog is accepted or refused, never 500');
  const bogus = await call('/control/command', json('POST', { nodeId: 'toaster', command: 'on' }));
  assert.equal(bogus.status, 409);
  assert.match(bogus.body.message, /unknown node/);
  const logRows = (await call('/log?limit=20')).body;
  assert.ok(logRows.some((r) => r.command === 'on' && r.outcome === 'refused' && r.actor === 'alice'), 'the refusal is logged against the human');
  currentSub = 'bob';
  assert.equal((await call('/control/command', json('POST', { nodeId: 'rover-arm-1', command: 'stop' }))).status, 409, 'bob does not hold command');
  currentSub = 'alice';
  assert.equal((await call('/control/release', json('POST', {}))).body.control.mode, 'auto');
  const final = await tickSeconds(600);
  assert.equal(final.control.executor, 'done', JSON.stringify(final.control));
  for (const pid of ['plate-1', 'plate-2']) assert.ok(ON_COUNTER_RIGHT.has(final.objects.find((o) => o.id === pid).location.surfaceId));
  assert.equal(pool.tasks.find((t) => t.task_id === id).status, 'done');
});

test('e-stop latches mid-run, marks the task aborted, refuses execution until reset', async () => {
  await call('/world/reset', json('POST', {}));
  const ids = await exploreViaApi();
  const d = await call('/tasks/draft', json('POST', { task: 'clear-surface', from: ids.basinId, to: ids.counterId }));
  const id = d.body.task_id;
  assert.equal((await call(`/tasks/${id}/execute`, json('POST', { confirm: true }))).status, 200);
  await tickSeconds(10);
  const stop = await call('/control/estop', json('POST', {}));
  assert.equal(stop.status, 200);
  assert.equal(stop.body.control.mode, 'estop');
  assert.equal(pool.tasks.find((t) => t.task_id === id).status, 'aborted');
  assert.equal((await call('/control/take', json('POST', {}))).status, 409);
  const again = await call('/tasks/draft', json('POST', { task: 'clear-surface', from: ids.basinId, to: ids.counterId }));
  assert.equal((await call(`/tasks/${again.body.task_id}/execute`, json('POST', { confirm: true }))).status, 409, 'no execution while latched');
  const reset = await call('/control/reset', json('POST', {}));
  assert.equal(reset.body.control.mode, 'idle');
  assert.equal((await call('/control/reset', json('POST', {}))).status, 409, 'a second reset has nothing to lift');
  const state = await call('/state');
  assert.equal(state.body.unit.estop, false);
  assert.equal(state.body.simulated, true);
});

test('the physics backend over the API: status, the model, a reset on a plant, a box without the engine answers 503; the certification gate lists, refuses and passes recorded flights and a certified policy flies the plant', async () => {
  const status = await call('/physics/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.engine.connected, false, 'no engine bridge at 127.0.0.1:1');
  assert.match(status.body.engine.installHint, /install-engine\.sh/);
  assert.deepEqual(status.body.backends, ['kinematic', 'physics', 'node']);
  const mjcf = await call('/physics/mjcf?fit=recon-mini');
  assert.equal(mjcf.status, 200); assert.match(mjcf.headers.get('content-type'), /xml/); assert.ok(mjcf.text.includes('<mujoco model="embodied-recon-mini">'));
  assert.equal((await call('/physics/mjcf?fit=nonsense')).status, 400);
  assert.equal((await call('/world/reset', json('POST', { backend: 'nonsense' }))).status, 400);
  const down = await call('/world/reset', json('POST', { backend: 'physics', sensorSet: 'recon-mini' }));
  assert.equal(down.status, 503, JSON.stringify(down.body).slice(0, 200));
  assert.equal(down.body.error, 'physics_unavailable'); assert.match(down.body.installHint, /install-engine\.sh/);
  assert.equal((await call('/physics/reports')).status, 503);
  // The same routes with a plant injected: the world runs on it.
  const { FakePlant } = require('./fake-plant');
  const plants = [];
  const home = [0.6, 0.6]; const cruise = 2.075;
  const reports = { dir: '/tmp/embodied-reports', policies: ['hover-leg-ppo-residual-seed0.zip'], reports: [
    { file: 'hover-leg-residual-seed0.json', report: { task: 'hover-leg', mode: 'residual', seed: 0, timesteps: 200000, policyFile: 'hover-leg-ppo-residual-seed0.zip', policyBeatsBaseline: true,
      baseline: { holdEndErrM: 0.01, legEndErrM: 0.015, trajectory: Array.from({ length: 15 }, (_, i) => [home[0] + 0.1 * i, home[1], cruise]) },
      policy: { holdEndErrM: 0.008, legEndErrM: 0.012, trajectory: Array.from({ length: 15 }, (_, i) => [home[0] + 0.1 * i, home[1], cruise]) } } },
    { file: 'hover-leg-absolute-seed9.json', report: { task: 'hover-leg', mode: 'absolute', seed: 9, timesteps: 80000, policyFile: 'hover-leg-ppo-absolute-seed9.zip', policyBeatsBaseline: false,
      baseline: { trajectory: [[home[0], home[1], cruise]] }, policy: { trajectory: [[home[0], home[1], cruise], [4.9, 3.9, cruise], [2.4, 2.0, 0.5]] } } },
    { file: 'broken.json', error: 'unexpected end of JSON input' },
  ] };
  const app2 = express(); app2.use(express.json());
  app2.use((req, _res, next) => { req.oidc = { user: { sub: 'carol' }, isAuthenticated: () => true }; next(); });
  app2.use('/api/embodied', createEmbodiedRoutes({ pool, appPackageDir: PKG }, { now: () => wall, noTimer: true, engineAddr: '127.0.0.1:1', reportReader: () => reports, plantFactory: (mjcf, seed, solids, h, controller) => { assert.ok(mjcf.includes('<mujoco')); const p = new FakePlant(solids, h, { seed, controller: controller.kind === 'policy' ? `policy:${controller.file}` : 'pid' }); p.spec = controller; plants.push(p); return p; } }));
  const server2 = await new Promise((r) => { const sv = app2.listen(0, '127.0.0.1', () => r(sv)); });
  const base2 = `http://127.0.0.1:${server2.address().port}/api/embodied`;
  const call2 = async (p, init = {}) => { const res = await fetch(base2 + p, init); const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; } return { status: res.status, body }; };
  try {
    const reset = await call2('/world/reset', json('POST', { backend: 'physics', sensorSet: 'recon-mini', seed: 7 }));
    assert.equal(reset.status, 200, JSON.stringify(reset.body).slice(0, 200));
    assert.equal(reset.body.drone.backend, 'physics'); assert.deepEqual(reset.body.drone.plant, { engine: 'fake', version: '0', seed: 7, controller: 'pid' });
    const d = await call2('/tasks/draft', json('POST', { task: 'explore', maxScans: 3, droneFirst: true }));
    assert.equal(d.status, 201, JSON.stringify(d.body).slice(0, 300));
    assert.equal(d.body.rehearsal.ok, true, d.body.rehearsal.issues.join('; '));
    assert.equal((await call2(`/tasks/${d.body.task_id}/execute`, json('POST', { confirm: true }))).status, 200);
    let last = null;
    for (let i = 0; i < 300; i += 1) { wall += 2000; last = (await call2('/state')).body; if (last.control.executor !== 'running' && i > 1) break; }
    assert.equal(last.control.executor, 'done', JSON.stringify(last.control));
    assert.equal(last.drone.backend, 'physics'); assert.equal(last.drone.mode, 'landed');
    assert.ok(last.world.stats.knownFraction > 0.2);
    assert.equal((await call2('/world/reset', json('POST', {}))).body.drone.backend, 'kinematic');
    assert.ok(plants[0].dropped, 'the plant of the reset world was dropped');
    // The certification gate: reports are listed with this owner's verdicts; a policy flies only after its path passed.
    const listed = await call2('/physics/reports');
    assert.equal(listed.status, 200); assert.equal(listed.body.reports.length, 3);
    assert.equal(listed.body.reports[0].certified, null, 'not certified yet'); assert.deepEqual(listed.body.policies, ['hover-leg-ppo-residual-seed0.zip']);
    const early = await call2('/world/reset', json('POST', { backend: 'physics', controller: 'policy:hover-leg-ppo-residual-seed0.zip' }));
    assert.equal(early.status, 409); assert.equal(early.body.error, 'policy_not_certified');
    assert.equal((await call2('/world/reset', json('POST', { backend: 'physics', controller: 'policy' }))).status, 400);
    assert.equal((await call2('/world/reset', json('POST', { backend: 'kinematic', controller: 'policy:x.zip' }))).status, 409, 'uncertified is refused before the backend check');
    assert.equal((await call2('/physics/certify', json('POST', {}))).status, 400);
    assert.equal((await call2('/physics/certify', json('POST', { file: 'nope.json' }))).status, 404);
    assert.equal((await call2('/physics/certify', json('POST', { file: 'broken.json' }))).status, 404);
    // This owner's world was just reset to kinematic and knows nothing: the path is refused as unknown space.
    const blind = await call2('/physics/certify', json('POST', { file: 'hover-leg-residual-seed0.json' }));
    assert.equal(blind.status, 200); assert.equal(blind.body.certification.ok, false); assert.match(blind.body.certification.refused[0].reason, /unknown/);
    assert.equal((await call2('/world/reset', json('POST', { backend: 'physics', controller: 'policy:hover-leg-ppo-residual-seed0.zip' }))).status, 409, 'a refused verdict does not certify');
    // Explore drone first, then certify: the hover-and-leg path over explored floor passes; the wild path does not.
    const d2 = await call2('/tasks/draft', json('POST', { task: 'explore', maxScans: 8, droneFirst: true }));
    assert.equal((await call2(`/tasks/${d2.body.task_id}/execute`, json('POST', { confirm: true }))).status, 200);
    for (let i = 0; i < 400; i += 1) { wall += 2000; const st = (await call2('/state')).body; if (st.control.executor !== 'running' && i > 1) break; }
    const passed = await call2('/physics/certify', json('POST', { file: 'hover-leg-residual-seed0.json' }));
    assert.equal(passed.status, 200, JSON.stringify(passed.body).slice(0, 300));
    assert.equal(passed.body.certification.ok, true, JSON.stringify(passed.body.certification.refused));
    assert.equal(passed.body.policyFile, 'hover-leg-ppo-residual-seed0.zip'); assert.equal(passed.body.beatsBaseline, true);
    const wild = await call2('/physics/certify', json('POST', { file: 'hover-leg-absolute-seed9.json' }));
    assert.equal(wild.body.certification.ok, false); assert.ok(wild.body.certification.refusedCount >= 2);
    const baseline = await call2('/physics/certify', json('POST', { file: 'hover-leg-absolute-seed9.json', which: 'baseline' }));
    assert.equal(baseline.body.certification.ok, true); assert.equal(baseline.body.policyFile, null, 'certifying the baseline path certifies no policy');
    const listed2 = await call2('/physics/reports');
    assert.equal(listed2.body.reports[0].certified.ok, true); assert.equal(listed2.body.reports[1].certified.ok, false);
    assert.equal((await call2('/world/reset', json('POST', { backend: 'kinematic', controller: 'policy:hover-leg-ppo-residual-seed0.zip' }))).status, 400, 'a policy needs the physics backend');
    const flown = await call2('/world/reset', json('POST', { backend: 'physics', sensorSet: 'recon-mini', controller: 'policy:hover-leg-ppo-residual-seed0.zip' }));
    assert.equal(flown.status, 200, JSON.stringify(flown.body).slice(0, 200));
    assert.equal(flown.body.drone.plant.controller, 'policy:hover-leg-ppo-residual-seed0.zip');
    assert.deepEqual(plants.at(-1).spec, { kind: 'policy', file: 'hover-leg-ppo-residual-seed0.zip', residual: true, interface: 'motors' }, 'the plant was loaded with the certified policy as a residual controller on the motor interface');
    assert.equal((await call2('/world/reset', json('POST', { backend: 'physics', controller: 'policy:hover-leg-ppo-absolute-seed9.zip' }))).status, 409, 'the refused policy stays refused');
  } finally { await new Promise((r) => server2.close(r)); }
});

test('B20: a node that joined the rail by heartbeat flies an owner\'s world through the same routes; silence takes it offline', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const { startFakeNode } = require('./fake-node');
  const { E } = require('./helpers');
  const { createEmbodiedNodeRoutes } = loadRoutes(); const { coreRequire, trustedSubMirror } = require('./routes.harness');
  const fleet = new E.DroneNodeFleet();
  let wall3 = 1_700_000_000_000;
  const app3 = express(); app3.use(express.json());
  // The heartbeat mount carries no identity: in the loader it is `auth: service` (asserted below), the secret being the mounter's guard.
  app3.use('/api/embodied/nodes', trustedSubMirror(), createEmbodiedNodeRoutes({ pool, appPackageDir: PKG }, { now: () => wall3, fleet }));
  app3.use((req, _res, next) => { req.oidc = { user: { sub: String(req.headers['x-test-sub'] || 'dave') }, isAuthenticated: () => true }; next(); });
  app3.use('/api/embodied', createEmbodiedRoutes({ pool, appPackageDir: PKG }, { now: () => wall3, noTimer: true, engineAddr: '127.0.0.1:1', fleet, serviceSecret: () => 'rail-secret' }));
  const server3 = await new Promise((r) => { const sv = app3.listen(0, '127.0.0.1', () => r(sv)); });
  const base3 = `http://127.0.0.1:${server3.address().port}`;
  const call3 = async (p, init = {}) => { const res = await fetch(`${base3}/api/embodied${p}`, init); const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; } return { status: res.status, body }; };
  // The node double heartbeats THIS package's engine tree hash, as the container does: the fleet must not flag it stale and the load must accept it.
  const node = await startFakeNode({ nodeId: 'plant-a', secret: 'rail-secret', apiUrl: base3, heartbeatMs: 100, buildHash: E.engineBuildHash(path.join(PKG, 'engine')), ownerSub: 'dave' });
  const asErin = (init = {}) => ({ ...init, headers: { ...(init.headers || {}), 'x-test-sub': 'erin' } });
  try {
    const bad = await fetch(`${base3}/api/embodied/nodes/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: '../x' }) });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'invalid_heartbeat');
    let status = null;
    for (let i = 0; i < 50 && !(status && status.nodes.some((n) => n.nodeId === 'plant-a' && n.online)); i += 1) { await new Promise((r) => setTimeout(r, 100)); status = (await call3('/physics/status')).body; }
    const row = status.nodes.find((n) => n.nodeId === 'plant-a');
    assert.ok(row && row.online, JSON.stringify(status.nodes));
    assert.equal(row.stale, false, 'the node heartbeats the package\'s engine tree hash');
    assert.equal(row.endpointUrl, node.endpointUrl); assert.equal(row.kind, 'plant'); assert.equal(row.engine, 'fake');
    assert.equal(status.rail.serviceSecretConfigured, true);
    assert.equal(row.ownerSub, 'dave', 'the node belongs to the owner its heartbeats carry');
    // Another owner neither sees nor uses dave's node (ADR-114: a node belongs to one person); the machine view lists it.
    assert.deepEqual((await call3('/physics/status', asErin())).body.nodes, []);
    const erin = await call3('/world/reset', asErin(json('POST', { backend: 'node', node: 'plant-a' })));
    assert.equal(erin.status, 404); assert.equal(erin.body.error, 'unknown_node');
    assert.deepEqual(status.backends, ['kinematic', 'physics', 'node']);
    assert.deepEqual((await fetch(`${base3}/api/embodied/nodes`).then((r) => r.json())).nodes.map((n) => n.nodeId), ['plant-a'], 'the machine listing on the nodes mount');
    const noNode = await call3('/world/reset', json('POST', { backend: 'node' }));
    assert.equal(noNode.status, 400); assert.equal(noNode.body.error, 'node_required'); assert.deepEqual(noNode.body.nodes, ['plant-a']);
    const unknown = await call3('/world/reset', json('POST', { backend: 'node', node: 'nobody' }));
    assert.equal(unknown.status, 404); assert.equal(unknown.body.error, 'unknown_node');
    const reset = await call3('/world/reset', json('POST', { backend: 'node', node: 'plant-a', sensorSet: 'recon-mini', seed: 4 }));
    assert.equal(reset.status, 200, JSON.stringify(reset.body).slice(0, 300));
    assert.equal(reset.body.drone.backend, 'node');
    assert.deepEqual(reset.body.drone.node, { nodeId: 'plant-a', link: 'rail', endpoint: node.endpointUrl });
    assert.deepEqual(reset.body.drone.plant, { engine: 'fake', version: '0', seed: 4, controller: 'pid' });
    const d = await call3('/tasks/draft', json('POST', { task: 'explore', maxScans: 3, droneFirst: true }));
    assert.equal(d.status, 201, JSON.stringify(d.body).slice(0, 300));
    assert.equal(d.body.rehearsal.ok, true, d.body.rehearsal.issues.join('; '));
    assert.equal((await call3(`/tasks/${d.body.task_id}/execute`, json('POST', { confirm: true }))).status, 200);
    let last = null;
    for (let i = 0; i < 300; i += 1) { wall3 += 2000; last = (await call3('/state')).body; if (last.control.executor !== 'running' && i > 1) break; }
    assert.equal(last.control.executor, 'done', JSON.stringify(last.control));
    assert.equal(last.drone.backend, 'node'); assert.equal(last.drone.mode, 'landed'); assert.ok(last.world.stats.knownFraction > 0.2);
    assert.ok((await node.stats()).commands > 400, 'the exploration flew over the rail (one envelope per 50 ms step)');
    await node.heartbeatNow();
    const seen = (await call3('/physics/status')).body.nodes.find((n) => n.nodeId === 'plant-a');
    assert.ok(seen.telemetry && ['landing', 'landed'].includes(seen.telemetry.phase), `the heartbeat carried the node's latest telemetry: ${JSON.stringify(seen.telemetry)}`);
    assert.ok(seen.events.some((e) => e.kind === 'load'), 'the load rode the heartbeat as an event');
    // Silence: the node stops heartbeating, the window passes, the fleet refuses to hand it out.
    node.stopHeartbeat(); await new Promise((r) => setTimeout(r, 400));
    wall3 += 20000;
    const gone = (await call3('/physics/status')).body.nodes.find((n) => n.nodeId === 'plant-a');
    assert.equal(gone.online, false);
    const refused = await call3('/world/reset', json('POST', { backend: 'node', node: 'plant-a' }));
    assert.equal(refused.status, 503); assert.equal(refused.body.error, 'node_offline'); assert.equal(refused.body.nodeId, 'plant-a');
    assert.equal((await call3('/state')).body.drone.backend, 'kinematic', 'the refused reset left a fresh kinematic world, never a dead link');
    // The manifest mounts the heartbeat route as a machine route: the swarm service secret, never a browser session.
    const yaml = coreRequire('js-yaml');
    const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
    const mount = manifest.routes.find((r) => r.mountPath === '/api/embodied/nodes');
    assert.ok(mount, 'the nodes mount is declared');
    assert.equal(mount.auth, 'service'); assert.equal(mount.factory, 'createEmbodiedNodeRoutes'); assert.equal(mount.module, 'routes/embodied-node-routes.js');
  } finally { await node.close(); await new Promise((r) => server3.close(r)); }
});

test('the printed arm: its design, a part as a CAD Studio program, its model and the check', async () => {
  const design = await call('/build/arm');
  assert.equal(design.status, 200, JSON.stringify(design.body).slice(0, 200));
  assert.equal(design.body.simulated, true);
  assert.equal(design.body.joints.length, 6, 'six joints');
  assert.deepEqual(design.body.undersized, [], 'no joint is left undersized');
  assert.ok(design.body.parts.length >= 10 && design.body.parts.every((part) => part.massEachG > 0), 'the parts carry their estimates');
  assert.ok(design.body.spec.joints.length === 6 && design.body.reachM > 0.3, 'the arm spec the sim would fly');
  assert.equal((await call('/build/arm?fit=nope')).status, 400, 'an unknown fit is refused');

  const part = await call('/build/arm/parts/upper-arm');
  assert.equal(part.status, 200);
  assert.equal(part.body.cadStudio.source.partId, 'upper-arm');
  assert.ok(part.body.cadStudio.features.length > 0 && part.body.cadStudio.base.kind === 'box', 'a CAD Studio program, base and features');
  assert.equal((await call('/build/arm/parts/nope')).status, 404);

  const md = await call('/build/arm/design.md');
  assert.equal(md.status, 200);
  assert.ok(String(md.body).includes('## How a joint is sized'), 'the document is generated');

  const mjcf = await call('/physics/arm/mjcf');
  assert.equal(mjcf.status, 200);
  assert.ok(String(mjcf.body).startsWith('<mujoco model="embodied-arm-desk-6"'), 'the model the container loads');
});

test('the arm check runs in the container and the route hands back what it measured', async () => {
  const { createEmbodiedRoutes: create, express: ex } = loadRoutes();
  let seen = null;
  const report = {
    task: 'arm-grasp', baseline: 'taught pick-and-place', payloadKg: 0.15, seeds: 2,
    holds: [{ joint: 'j2', designNm: 2.04, measuredNm: 2.06, usableNm: 2.94, poseBlocked: false, agreesWithDesign: true, withinContinuous: true }],
    run: { successRate: 1, meanSeconds: 0.8, peakTorqueNm: [1, 2, 1, 0, 1, 1], meanTorqueNm: [0.1, 1.2, 0.5, 0, 0.2, 0.1], episodes: [] },
    dutyOfContinuous: [0.1, 0.4, 0.3, 0, 0.2, 0.1],
    verdict: { holdsItsPayload: true, physicsAgreesWithDesign: true, taskSucceeds: true, withinDutyCycle: true }, wallSeconds: 2.3,
  };
  const appA = ex();
  appA.use(ex.json());
  appA.use((req, _res, next) => { req.oidc = { user: { sub: 'owner-arm' } }; next(); });
  appA.use('/api/embodied', create({ pool: fakePool(), appPackageDir: PKG }, { now: () => Date.now(), noTimer: true, engineAddr: '127.0.0.1:1', armChecker: async (input) => { seen = input; return report; } }));
  const sv = await new Promise((r) => { const s2 = appA.listen(0, '127.0.0.1', () => r(s2)); });
  const hit = async (p, init = {}) => { const res = await fetch(`http://127.0.0.1:${sv.address().port}/api/embodied${p}`, init); const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; } return { status: res.status, body }; };
  try {
    const ok = await hit('/physics/arm/check', json('POST', { seeds: 2 }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
    assert.equal(ok.body.report.verdict.holdsItsPayload, true);
    assert.equal(ok.body.joints.length, 6, 'the route says what the design asked of each joint');
    assert.ok(seen && seen.mjcf.startsWith('<mujoco'), 'the container was given the generated model');
    assert.equal(seen.seeds, 2);
    assert.equal(seen.worst.length, 6, 'and the worst pose of each joint');
    assert.ok(seen.designNm[1] > 1, 'and what the design expects it to carry');
    assert.equal((await hit('/physics/arm/check', json('POST', { seeds: 9 }))).status, 400, 'more scenes than the check allows is refused');
    assert.equal((await hit('/physics/arm/check', json('POST', { fit: 'nope' }))).status, 400, 'an unknown fit is refused');
  } finally { await new Promise((r) => sv.close(r)); }
});

test('an arm check the container cannot run is an honest 503', async () => {
  const { createEmbodiedRoutes: create, express: ex } = loadRoutes();
  const appB = ex();
  appB.use(ex.json());
  appB.use((req, _res, next) => { req.oidc = { user: { sub: 'owner-arm' } }; next(); });
  appB.use('/api/embodied', create({ pool: fakePool(), appPackageDir: PKG }, { now: () => Date.now(), noTimer: true, engineAddr: '127.0.0.1:1', armChecker: async () => { throw new Error('the physics engine is not there'); } }));
  const sv = await new Promise((r) => { const s2 = appB.listen(0, '127.0.0.1', () => r(s2)); });
  try {
    const res = await fetch(`http://127.0.0.1:${sv.address().port}/api/embodied/physics/arm/check`, json('POST', {}));
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'physics_unavailable');
    assert.ok(body.installHint, 'and it says how to install the container');
  } finally { await new Promise((r) => sv.close(r)); }
});

test('B22: the world stands the arm up on physics, refuses a bad mount, and says the rail is not ours to open', async () => {
  const { FakeArmPlant } = require('./fake-arm-plant');
  const { createEmbodiedRoutes: create, express: ex } = loadRoutes();
  const arms = [];
  const appC = ex();
  appC.use(ex.json());
  appC.use((req, _res, next) => { req.oidc = { user: { sub: 'owner-b22' }, isAuthenticated: () => true }; next(); });
  appC.use('/api/embodied', create({ pool: fakePool(), appPackageDir: PKG }, { now: () => Date.now(), noTimer: true, engineAddr: '127.0.0.1:1',
    armPlantFactory: (mjcf, seed, mount, dh) => {
      assert.ok(mjcf.includes('<mujoco model="embodied-arm-room-'), 'the ROOM model, not the bench model');
      assert.ok(mjcf.includes('class="scene" type="box"'), 'the scene stands around it');
      assert.equal(dh.length, 6, 'the plant carries the joint table it was built from');
      const a = new FakeArmPlant({ seed, dh, q: new Array(6).fill(0) });
      a.mount = mount; arms.push(a); return a;
    } }));
  const sv = await new Promise((r) => { const s2 = appC.listen(0, '127.0.0.1', () => r(s2)); });
  const at = `http://127.0.0.1:${sv.address().port}/api/embodied`;
  const hit = async (path, init = {}) => { const res = await fetch(at + path, init); const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; } return { status: res.status, body }; };
  try {
    const on = await hit('/world/reset', json('POST', { arm: 'physics' }));
    assert.equal(on.status, 200, JSON.stringify(on.body).slice(0, 220));
    assert.equal(on.body.unit.backend, 'physics');
    assert.equal(on.body.unit.node, null, 'a dialled plant carries no node identity');
    assert.equal(arms.length, 1, 'one arm was stood up');
    assert.ok(Math.abs(arms[0].mount.z - on.body.unit.base.liftZ) < 1e-9, 'mounted at the carriage lift');

    // Half (b): an arm on the swarm rail. Declared, and refused with the reason — core ADR-149 is not ours to open.
    const rail = await hit('/world/reset', json('POST', { arm: 'node' }));
    assert.equal(rail.status, 501);
    assert.equal(rail.body.error, 'arm_node_unavailable');
    assert.match(rail.body.message, /ADR-149/);

    const bogus = await hit('/world/reset', json('POST', { arm: 'kinetic' }));
    assert.equal(bogus.status, 400);
    assert.equal(bogus.body.error, 'unknown_arm_backend');

    // A scenario that is not this caller's is refused before an arm is ever stood up.
    const notMine = await hit('/world/reset', json('POST', { arm: 'physics', scenario: 'scan:someone-elses' }));
    assert.equal(notMine.status, 400);
    assert.equal(notMine.body.error, 'unknown_scenario');
    assert.equal(arms.length, 1, 'no arm was built for a scenario the caller does not own');

    const off = await hit('/world/reset', json('POST', {}));
    assert.equal(off.status, 200);
    assert.equal(off.body.unit.backend, 'kinematic', 'the default is unchanged');
  } finally { await new Promise((r) => sv.close(r)); }
});

test('ADR-160 S1: the media publish, the hull falls in air, and seawater is refused by name', async () => {
  const media = await call('/physics/media');
  assert.equal(media.status, 200);
  assert.deepEqual(media.body.media.map((m) => m.id), ['vacuum', 'air', 'seawater']);
  const sea = media.body.media.find((m) => m.id === 'seawater');
  assert.equal(sea.densityKgM3, 1025, "the shared row's seawater density reaches the surface");
  assert.equal(sea.freeSurface, null, 'nothing in this package models a free surface, and the record says so');
  assert.equal(sea.speedOfSoundMs, null, 'a property the medium cannot answer is null, never defaulted');
  const plant = media.body.forceModels.find((m) => m.id === 'rigid-body-plant');
  assert.deepEqual(plant.validIn, ['vacuum', 'air'], 'the envelope is declared by the model author');
  assert.ok(Object.keys(media.body.refusals).includes('model_not_valid_in_medium'));

  // In AIR the hull falls at g, and the flotation question is refused in the same answer.
  const air = await call('/physics/hull?medium=air&dropHeightM=2');
  assert.equal(air.status, 200);
  assert.equal(air.body.hull.allUpMassKg, 24.7);
  assert.equal(air.body.hull.envelopeM, 0.3);
  assert.ok(Math.abs(air.body.fall.fallTimeS - Math.sqrt(4 / 9.81)) < 1e-9, 'sqrt(2h/g)');
  assert.equal(air.body.flotation.refusal, 'medium_property_unavailable: freeSurface');
  assert.ok(air.body.provenance.allUpMassKg.includes('READ, not quoted'));

  const mjcf = await call('/physics/hull/mjcf?medium=air');
  assert.equal(mjcf.status, 200);
  assert.ok(mjcf.text.includes('gravity="0 0 -9.81"') && mjcf.text.includes('model="explorer-hull-air"'));
  assert.ok(!/<option[^>]*density=/.test(mjcf.text), 'no fluid claim is ever emitted');

  // In SEAWATER it refuses BY NAME rather than pretending to float.
  for (const path of ['/physics/hull?medium=seawater', '/physics/hull/mjcf?medium=seawater']) {
    const refused = await call(path);
    assert.equal(refused.status, 422, path);
    assert.equal(refused.body.error, 'model_not_valid_in_medium');
    assert.equal(refused.body.refusal, 'model_not_valid_in_medium: rigid-body-plant, seawater');
    assert.equal(refused.body.medium, 'seawater');
  }

  // Outside the medium's own band it refuses rather than extrapolating.
  const high = await call('/physics/hull?medium=air&dropHeightM=500');
  assert.equal(high.status, 422);
  assert.equal(high.body.error, 'medium_outside_validity');

  // A medium this lab does not implement is named, not substituted.
  const unknown = await call('/physics/hull?medium=helium');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'unknown_medium');
  assert.deepEqual(unknown.body.media, ['vacuum', 'air', 'seawater']);

  // And all three are behind the caller gate.
  const was = currentSub; currentSub = null;
  try {
    for (const path of ['/physics/media', '/physics/hull?medium=air', '/physics/hull/mjcf?medium=air']) {
      assert.equal((await call(path)).status, 401, path);
    }
  } finally { currentSub = was; }
});
