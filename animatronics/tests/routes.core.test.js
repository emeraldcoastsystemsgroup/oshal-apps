/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The loopback app and the in-memory pool moved to tests/core.fixture.js, shared with the browser suite; the served browser protocol module is evaluated in a sandbox; look-at rehearses without arming and leaves the believed pose alone.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express resolved from the framework checkout (OSHAL_CORE_DIR): the surface, assets, capabilities, catalog and templates serve; the caller gate 401s; a rig is created from a template (manifest kind prop, axes, idle power) and a bad rig is refused naming the field; poses and scenarios are set one per call, refused out of limits, on a cycle, and deletion is refused while referenced; REHEARSE answers report + frames + protocol lines and logs a run; PLAY, LOOK-AT and JOG are 409 until armed; ARM is 428 without confirm, 422 on a refused supply, and answers hello + clamps + the neutral frame; PLAY advances the believed pose and logs; LOOK-AT splits eyes and neck; JOG refuses an out-of-limit axis; a rig change disarms; DISARM answers the e-stop line; owner scoping 404s; the command log lists newest first; the Home summary; deletion. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { startApp } = require('./core.fixture.js');

// ── The app on loopback (compiled routes, in-memory pool — see core.fixture.js) ──
let app; let base; let pool;
test.before(async () => { app = await startApp(); base = app.baseUrl; pool = app.pool; });
test.after(async () => { await app.stop(); });

const ALICE = 'alice'; const BOB = 'bob';
async function call(method, url, body, sub = ALICE) {
  const res = await fetch(base + url, { method, headers: { ...(sub ? { 'x-test-sub': sub } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
}

let rigId;

test('surface, assets, capabilities, catalog and templates serve', async () => {
  const page = await call('GET', '/api/animatronics/app', undefined, null);
  assert.equal(page.status, 200); assert.match(page.type, /html/); assert.match(page.text, /Animatronics/);
  for (const f of ['animatronics.js', 'animatronics-view.js', 'animatronics-serial.js']) { const a = await call('GET', `/api/animatronics/assets/${f}`, undefined, null); assert.equal(a.status, 200, f); assert.match(a.type, /javascript/); }
  const caps = await call('GET', '/api/animatronics/capabilities', undefined, null);
  assert.equal(caps.status, 200);
  assert.equal(caps.json.kind.kind, 'prop'); assert.equal(caps.json.contract.frameHz, 50); assert.equal(caps.json.templates.length, 3); assert.equal(caps.json.protocol.example.hello, 'H*48');
  const cat = await call('GET', '/api/animatronics/catalog/servos?kind=bus', undefined, null);
  assert.equal(cat.status, 200); assert.ok(cat.json.servos.every((s) => s.kind === 'bus')); assert.ok(cat.json.controllers.length >= 3);
  assert.equal((await call('GET', '/api/animatronics/catalog/servos?kind=linear', undefined, null)).status, 400);
  const t = await call('GET', '/api/animatronics/templates', undefined, null);
  assert.equal(t.json.templates.find((x) => x.id === 'skull').rig.channels.length, 7);
  const proto = await call('GET', '/api/animatronics/assets/protocol.js', undefined, null);
  assert.equal(proto.status, 200); assert.match(proto.type, /javascript/);
  const sandbox = { window: {} };
  require('node:vm').runInNewContext(proto.text, sandbox);
  assert.equal(sandbox.window.AnimatronicsProtocol.parseLine('H*48').kind, 'hello', 'the browser gets the very same compiled protocol module');
  assert.equal(sandbox.window.AnimatronicsProtocol.encodeEstop(), 'E*45\n');
});

test('the manifest and the Test Lab catalog load through the framework\'s own loader (the limits the box enforces on install)', () => {
  const { CORE, PKG, frameworkRequire } = require('./core.fixture.js');
  const coreRequire = frameworkRequire();
  const fs = require('node:fs'); const path = require('node:path');
  const manifest = coreRequire('js-yaml').load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  assert.equal(manifest.name, 'animatronics'); assert.equal(manifest.suite, 'ai-creative');
  const { loadPackageTestCatalog } = coreRequire(path.join(CORE, 'scripts', 'oshal-test-catalog.js'));
  const loaded = loadPackageTestCatalog(PKG, manifest);
  const cases = loaded.catalog.cases;
  assert.equal(cases.length, 10);
  for (const c of cases) for (const line of c.expected) assert.ok(line.length <= 500, `${c.id}: ${line.slice(0, 40)}`);
  const persona = coreRequire('js-yaml').load(fs.readFileSync(path.join(PKG, manifest.bots[0].persona), 'utf8'));
  assert.equal(persona.agent_id, manifest.bots[0].agentId, 'the persona and the manifest name the same agent');
});

test('the caller gate 401s on every rig route', async () => {
  assert.equal((await call('GET', '/api/animatronics/rigs', undefined, null)).status, 401);
  assert.equal((await call('POST', '/api/animatronics/rigs', { template: 'skull' }, null)).status, 401);
});

test('a rig is created from a template; a bad rig is refused naming the field', async () => {
  const r = await call('POST', '/api/animatronics/rigs', { template: 'skull', title: '  Halloween   skull ' });
  assert.equal(r.status, 201);
  rigId = r.json.rig.rig_id;
  assert.equal(r.json.rig.title, 'Halloween skull'); assert.equal(r.json.rig.rig.channels.length, 7); assert.equal(r.json.rig.armed, false);
  assert.deepEqual(r.json.rig.axes, ['eyes.pan', 'eyes.tilt', 'lids.upper', 'lids.lower', 'neck.yaw', 'neck.pitch', 'jaw.open']);
  assert.equal(r.json.rig.manifest.kind, 'prop'); assert.equal(r.json.rig.manifest.safetyClass, 2);
  assert.equal(r.json.power.verdict, 'ok'); assert.equal(r.json.rig.current_pose['jaw.open'], 0);
  assert.deepEqual(r.json.rig.source, { kind: 'template', template: 'skull' });
  const bad = await call('POST', '/api/animatronics/rigs', { rig: { channels: [{ id: 'a', channel: 0, model: 'sg90', minDeg: -170, maxDeg: 170 }] } });
  assert.equal(bad.status, 400); assert.equal(bad.json.error, 'invalid_input'); assert.equal(bad.json.field, 'rig.channels[0].minDeg');
  assert.equal((await call('POST', '/api/animatronics/rigs', { template: 'robot-dog' })).json.field, 'template');
  assert.equal((await call('POST', '/api/animatronics/rigs', {})).json.field, 'rig');
  const list = await call('GET', '/api/animatronics/rigs');
  assert.equal(list.json.rigs.length, 1);
  const one = await call('GET', `/api/animatronics/rigs/${rigId}`);
  assert.equal(one.status, 200); assert.deepEqual(one.json.runs, []); assert.equal(one.json.power.idleA, 0.07);
});

test('poses and scenarios: one per call, refused out of limits or on a cycle, deletion refused while referenced', async () => {
  const ok = await call('PUT', `/api/animatronics/rigs/${rigId}/poses/LOOK_FAR_RIGHT`, { axes: { 'eyes.pan': 29, 'neck.yaw': 40 } });
  assert.equal(ok.status, 200); assert.deepEqual(ok.json.pose, { LOOK_FAR_RIGHT: { 'eyes.pan': 29, 'neck.yaw': 40 } });
  const over = await call('PUT', `/api/animatronics/rigs/${rigId}/poses/TOO_FAR`, { 'eyes.pan': 31 });
  assert.equal(over.status, 400); assert.equal(over.json.field, 'poses.TOO_FAR.eyes.pan');
  assert.equal((await call('PUT', `/api/animatronics/rigs/${rigId}/poses/lowercase`, { 'eyes.pan': 1 })).json.field, 'poseId');
  const sc = await call('PUT', `/api/animatronics/rigs/${rigId}/scenarios/GLARE`, { description: 'stare far right then blink', steps: [{ kind: 'move', pose: 'LOOK_FAR_RIGHT', ms: 500 }, { kind: 'run', scenario: 'BLINK' }, { kind: 'move', pose: 'NEUTRAL', ms: 600 }] });
  assert.equal(sc.status, 200); assert.equal(sc.json.scenario.GLARE.steps.length, 3); assert.equal(sc.json.scenario.GLARE.description, 'stare far right then blink');
  const cycle = await call('PUT', `/api/animatronics/rigs/${rigId}/scenarios/BLINK`, { steps: [{ kind: 'run', scenario: 'GLARE' }] });
  assert.equal(cycle.status, 400); assert.match(cycle.json.message, /runs itself/);
  const inUse = await call('DELETE', `/api/animatronics/rigs/${rigId}/poses/LOOK_FAR_RIGHT`);
  assert.equal(inUse.status, 409); assert.equal(inUse.json.error, 'pose_in_use'); assert.match(inUse.json.field, /scenarios\.GLARE/);
  const scInUse = await call('DELETE', `/api/animatronics/rigs/${rigId}/scenarios/BLINK`);
  assert.equal(scInUse.status, 409); assert.equal(scInUse.json.error, 'scenario_in_use');
  assert.equal((await call('DELETE', `/api/animatronics/rigs/${rigId}/scenarios/NOPE`)).status, 404);
  const gone = await call('DELETE', `/api/animatronics/rigs/${rigId}/scenarios/GLARE`);
  assert.equal(gone.status, 200); assert.equal(gone.json.deleted, 'GLARE');
  assert.equal((await call('DELETE', `/api/animatronics/rigs/${rigId}/poses/LOOK_FAR_RIGHT`)).status, 200);
});

test('rehearse answers report, frames and protocol lines, and logs a run without arming', async () => {
  const r = await call('POST', `/api/animatronics/rigs/${rigId}/rehearse`, { scenario: 'BLINK' });
  assert.equal(r.status, 200); assert.equal(r.json.run, 1);
  assert.equal(r.json.report.verdict.ok, true); assert.equal(r.json.report.durationMs, 320);
  assert.equal(r.json.frames.angles.length, 17); assert.equal(r.json.frames.actual.length, 17); assert.equal(r.json.lines.length, 17);
  assert.match(r.json.lines[0], /^F 1 0=/);
  assert.equal(r.json.report.power.verdict, 'ok');
  const steps = await call('POST', `/api/animatronics/rigs/${rigId}/rehearse`, { steps: [{ kind: 'move', axes: { 'jaw.open': 30 }, ms: 20, ease: 'linear' }], start: { 'jaw.open': 0 } });
  assert.equal(steps.status, 200); assert.equal(steps.json.report.verdict.followed, false); assert.match(steps.json.report.verdict.summary, /^refused — jaw lags/);
  assert.equal((await call('POST', `/api/animatronics/rigs/${rigId}/rehearse`, { scenario: 'NOPE' })).json.field, 'scenario');
  assert.equal((await call('POST', `/api/animatronics/rigs/${rigId}/rehearse`, {})).status, 400);
  const row = await call('GET', `/api/animatronics/rigs/${rigId}`);
  assert.equal(row.json.rig.armed, false); assert.equal(row.json.runs.length, 2); assert.equal(row.json.runs[0].kind, 'rehearse'); assert.equal(row.json.runs[1].scenario, 'BLINK');
});

test('play, look-at and jog are 409 until armed; arm is 428 without confirm and answers the bring-up lines', async () => {
  for (const [route, body] of [['play', { scenario: 'TALK' }], ['look-at', { azDeg: 10, elDeg: 0 }], ['jog', { axes: { 'jaw.open': 5 } }]]) {
    const r = await call('POST', `/api/animatronics/rigs/${rigId}/${route}`, body);
    assert.equal(r.status, 409, route); assert.equal(r.json.error, 'rig_not_armed');
  }
  const dry = await call('POST', `/api/animatronics/rigs/${rigId}/look-at`, { azDeg: 20, elDeg: 10, rehearse: true });
  assert.equal(dry.status, 200, 'look-at rehearses without arming'); assert.deepEqual(dry.json.lookAt.pose, { 'eyes.pan': 12, 'eyes.tilt': 6, 'neck.yaw': 8, 'neck.pitch': 4 });
  assert.equal(dry.json.report.verdict.ok, true); assert.equal(dry.json.rig, undefined, 'a rehearsal does not move the believed pose');
  assert.equal((await call('GET', `/api/animatronics/rigs/${rigId}`)).json.rig.current_pose['neck.yaw'], 0);
  const unconfirmed = await call('POST', `/api/animatronics/rigs/${rigId}/arm`, {});
  assert.equal(unconfirmed.status, 428); assert.equal(unconfirmed.json.guard, 'animatronics-arm');
  const armed = await call('POST', `/api/animatronics/rigs/${rigId}/arm`, { confirm: true });
  assert.equal(armed.status, 200); assert.equal(armed.json.rig.armed, true); assert.ok(armed.json.rig.armed_at);
  assert.equal(armed.json.lines[0], 'H*48\n');
  assert.equal(armed.json.lines.filter((l) => l.startsWith('L ')).length, 7);
  assert.match(armed.json.lines[8], /^F 0 0=1450,1=1450,2=1450,3=1450,4=1500,5=1500,6=1500\*/);
});

test('play advances the believed pose and logs; look-at splits eyes and neck; jog refuses out of limits', async () => {
  const play = await call('POST', `/api/animatronics/rigs/${rigId}/play`, { scenario: 'SCARE' });
  assert.equal(play.status, 200); assert.equal(play.json.report.verdict.ok, true); assert.equal(play.json.lines.length, play.json.frames.angles.length);
  assert.equal(play.json.rig.current_pose['jaw.open'], 0); assert.equal(play.json.rig.current_pose['lids.upper'], 0);
  const half = await call('POST', `/api/animatronics/rigs/${rigId}/play`, { pose: 'JAW_HALF', ms: 300 });
  assert.equal(half.status, 200); assert.equal(half.json.rig.current_pose['jaw.open'], 15);
  const next = await call('POST', `/api/animatronics/rigs/${rigId}/play`, { pose: 'JAW_CLOSED', ms: 300 });
  assert.equal(next.json.frames.angles[0][6], 15, 'the next stream starts where the last one ended');
  const la = await call('POST', `/api/animatronics/rigs/${rigId}/look-at`, { azDeg: 60, elDeg: -20 });
  assert.equal(la.status, 200); assert.deepEqual(la.json.lookAt.pose, { 'eyes.pan': 30, 'eyes.tilt': -12, 'neck.yaw': 30, 'neck.pitch': -8 }); assert.equal(la.json.lookAt.reachable, true);
  assert.equal(la.json.rig.current_pose['neck.yaw'], 30);
  assert.equal((await call('POST', `/api/animatronics/rigs/${rigId}/look-at`, { azDeg: 400 })).json.field, 'azDeg');
  const jog = await call('POST', `/api/animatronics/rigs/${rigId}/jog`, { axes: { 'jaw.open': 10 } });
  assert.equal(jog.status, 200); assert.equal(jog.json.rig.current_pose['jaw.open'], 10); assert.equal(jog.json.report.durationMs, 120);
  const bad = await call('POST', `/api/animatronics/rigs/${rigId}/jog`, { axes: { 'jaw.open': 90 } });
  assert.equal(bad.status, 400); assert.equal(bad.json.field, 'axes.steps[0].axes.jaw.open');
  const runs = await call('GET', `/api/animatronics/rigs/${rigId}/runs`);
  assert.deepEqual(runs.json.runs.slice(0, 4).map((r) => r.kind), ['jog', 'look-at', 'play', 'play']);
  assert.equal(runs.json.runs.find((r) => r.scenario === 'SCARE').kind, 'play');
  assert.match(runs.json.runs[0].verdict, /^ok — 120 ms/);
});

test('a rig change disarms; a refused supply blocks arming; disarm answers the e-stop line', async () => {
  const before = await call('GET', `/api/animatronics/rigs/${rigId}`);
  const usb = { ...before.json.rig.rig, supply: { volts: 5, amps: 0.5, source: 'usb' } };
  const patched = await call('PATCH', `/api/animatronics/rigs/${rigId}`, { rig: usb, title: 'USB skull' });
  assert.equal(patched.status, 200); assert.equal(patched.json.rig.armed, false); assert.equal(patched.json.disarmed, true); assert.equal(patched.json.power.verdict, 'refuse'); assert.equal(patched.json.rig.title, 'USB skull');
  assert.equal(patched.json.rig.current_pose['neck.yaw'], 0, 'a changed rig is believed neutral again');
  const arm = await call('POST', `/api/animatronics/rigs/${rigId}/arm`, { confirm: true });
  assert.equal(arm.status, 422); assert.equal(arm.json.error, 'supply_refused'); assert.match(arm.json.power.reasons[0], /USB/);
  const bench = await call('PATCH', `/api/animatronics/rigs/${rigId}`, { rig: { ...usb, supply: { volts: 6, amps: 5, source: 'bench' } } });
  assert.equal(bench.json.power.verdict, 'ok');
  const badPatch = await call('PATCH', `/api/animatronics/rigs/${rigId}`, { poses: { NEUTRAL: { 'eyes.pan': 99 } } });
  assert.equal(badPatch.status, 400); assert.equal(badPatch.json.field, 'poses.NEUTRAL.eyes.pan');
  assert.equal((await call('POST', `/api/animatronics/rigs/${rigId}/arm`, { confirm: true })).status, 200);
  const off = await call('POST', `/api/animatronics/rigs/${rigId}/disarm`, { reason: 'test' });
  assert.equal(off.status, 200); assert.equal(off.json.rig.armed, false); assert.deepEqual(off.json.lines, ['E*45\n']);
  assert.equal((await call('POST', `/api/animatronics/rigs/${rigId}/play`, { scenario: 'TALK' })).status, 409);
});

test('owner scoping, the manifest route, the Home summary and deletion', async () => {
  assert.equal((await call('GET', `/api/animatronics/rigs/${rigId}`, undefined, BOB)).status, 404);
  assert.equal((await call('POST', `/api/animatronics/rigs/${rigId}/arm`, { confirm: true }, BOB)).status, 404);
  assert.equal((await call('GET', '/api/animatronics/rigs', undefined, BOB)).json.rigs.length, 0);
  assert.equal((await call('GET', '/api/animatronics/rigs/not-a-uuid')).status, 400);
  const m = await call('GET', `/api/animatronics/rigs/${rigId}/manifest`);
  assert.equal(m.json.manifest.kind, 'prop'); assert.equal(m.json.manifest.nodeId, `prop-${rigId.slice(0, 8)}`);
  assert.equal((await call('GET', '/api/animatronics/home-summary', undefined, null)).status, 401);
  const home = await call('GET', '/api/animatronics/home-summary');
  assert.equal(home.status, 200);
  assert.deepEqual(home.json.metrics.map((x) => [x.id, x.value]), [['rigs-total', '1'], ['rigs-armed', '0'], ['runs-total', String(pool.tables.animatronic_run.length)]]);
  assert.match(home.json.items[0].text, /USB skull/);
  const del = await call('DELETE', `/api/animatronics/rigs/${rigId}`);
  assert.equal(del.status, 200); assert.equal(del.json.deleted, rigId);
  assert.equal((await call('GET', `/api/animatronics/rigs/${rigId}`)).status, 404);
  assert.equal(pool.tables.animatronic_run.length, 0, 'runs cascade');
});
