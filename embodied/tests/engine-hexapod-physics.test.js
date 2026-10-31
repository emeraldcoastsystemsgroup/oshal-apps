/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-202 lane L2: the spider-18 MJCF generator and its routes without a container. The eighteen position actuators are named and ordered as ACTUATOR_ORDER; the left coxa hinges turn about -z and the right about +z, femur and tibia about the leg's lateral axis; every range is the contract's limit in radians and every force limit the servo row's stall torque; gravity is the air medium row's and the generator source carries no literal; the spring piston and its latch exist only under latched-spring; the Python mirror fixture is exactly what invertedJointTargets produces; the fixtures on disk are what the generator emits; the routes hand out the model, refuse an unknown fit, jump or seed count, send one model per check to the engine and answer an engine that is down with the tile's 503.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-202 integration: the route cases expect models built from the design's computed masses; the generator and fixture cases keep the brief's.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | B29: the fixtures are regenerated from the design's computed masses, so fixtures, plant tests, task and routes load one model.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: POST /physics/hexapod/certify -- the design's continuous torque goes to the gate, the certificate is remembered for the owner, a pathed or non-hexapod name is refused before the engine, the gate's named refusals answer with their status, and an engine that is down is the tile's 503.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const spec = require(path.join(__dirname, '..', 'routes', 'engine', 'design', 'hexapod-spec.js'));
const gen = require(path.join(__dirname, '..', 'routes', 'engine', 'physics', 'hexapod-mjcf.js'));
const { servoRow } = require(path.join(__dirname, '..', 'routes', 'engine', 'design', 'parts-catalog.js'));
const { servoSpecFrom } = require(path.join(__dirname, '..', 'routes', 'engine', 'design', 'servos.js'));
const { mediumById } = require(path.join(__dirname, '..', 'routes', 'engine', 'medium', 'medium.js'));
const { EngineFailure } = require(path.join(__dirname, '..', 'routes', 'engine', 'physics', 'bridge-client.js'));
const { SATURATION_ERROR_RAD } = require(path.join(__dirname, '..', 'routes', 'engine', 'physics', 'arm-mjcf.js'));
const routes = require(path.join(__dirname, '..', 'routes', 'embodied-hexapod-physics-routes.js'));

const FIXTURES = path.join(__dirname, '..', 'engine', 'tests', 'fixtures');
const SOURCE = path.join(__dirname, '..', 'src-routes', 'engine', 'physics', 'hexapod-mjcf.ts');
const DEG = Math.PI / 180;
const f = (n) => String(Number(n.toFixed(6)));
// The fixtures, the plant's tests, the training task and the live routes all load the DESIGN's computed masses (ADR-202, B29 closed).
const design = require('../routes/engine/design/hexapod-design.js');
const masses = design.buildHexapod('spider-18').masses;
const hop = gen.hexapodMjcf(spec.SPIDER_18, masses, { jump: 'legs-hop' });
const sprung = gen.hexapodMjcf(spec.SPIDER_18, masses, { jump: 'latched-spring' });
const attr = (line, name) => (line.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
const jointLine = (xml, name) => xml.split('\n').find((l) => l.includes(`<joint name="${name}"`));
const actuatorLines = (xml) => xml.split('\n').filter((l) => l.includes('<position '));

test('eighteen position actuators, named and ordered exactly as ACTUATOR_ORDER, each driving its own joint', () => {
  for (const xml of [hop, sprung]) {
    const lines = actuatorLines(xml);
    assert.equal(lines.length, 18);
    assert.deepEqual(lines.map((l) => attr(l, 'name')), spec.ACTUATOR_ORDER);
    assert.deepEqual(lines.map((l) => attr(l, 'joint')), spec.ACTUATOR_ORDER);
    assert.equal((xml.match(/<motor /g) || []).length, 0, 'position servos, not torque motors');
  }
});

test('the left coxa hinges turn about -z and the right about +z; femur and tibia about the leg\'s lateral axis', () => {
  for (const leg of spec.LEG_IDS) {
    assert.equal(attr(jointLine(hop, `${leg}-coxa`), 'axis'), leg[0] === 'L' ? '0 0 -1' : '0 0 1', `${leg} coxa`);
    assert.equal(attr(jointLine(hop, `${leg}-femur`), 'axis'), '0 1 0', `${leg} femur`);
    assert.equal(attr(jointLine(hop, `${leg}-tibia`), 'axis'), '0 1 0', `${leg} tibia`);
  }
  const plant = gen.hexapodPlant();
  assert.deepEqual(plant.legs.map((l) => l.coxaAxisZ), [-1, -1, -1, 1, 1, 1]);
});

test('every range is the contract\'s limit in radians and every force limit is the servo row\'s stall torque', () => {
  const servo = servoSpecFrom(servoRow(spec.SPIDER_18.servoRowId));
  const limits = { coxa: spec.SPIDER_18.limits.coxaDeg, femur: spec.SPIDER_18.limits.femurDeg, tibia: spec.SPIDER_18.limits.tibiaDeg };
  for (const name of spec.ACTUATOR_ORDER) {
    const joint = name.split('-')[1];
    const range = `${f(limits[joint][0] * DEG)} ${f(limits[joint][1] * DEG)}`;
    assert.equal(attr(jointLine(hop, name), 'range'), range, `${name} joint range`);
    const act = actuatorLines(hop).find((l) => attr(l, 'name') === name);
    assert.equal(attr(act, 'ctrlrange'), range, `${name} ctrlrange`);
    assert.equal(attr(act, 'forcerange'), `${f(-servo.stallNm)} ${f(servo.stallNm)}`, `${name} forcerange`);
    assert.equal(attr(act, 'forcelimited'), 'true');
    assert.equal(attr(act, 'kp'), f(servo.stallNm / SATURATION_ERROR_RAD), `${name} kp is stall over the arm's saturation error`);
  }
  const plant = gen.hexapodPlant();
  for (const j of plant.joints) {
    assert.equal(j.stallNm, servo.stallNm);
    assert.ok(Math.abs(j.damping - servo.stallNm / servo.noLoadRadS) < 1e-12, 'damping = stall / no-load speed');
  }
});

test('gravity is the air medium row\'s vector, and the generator source carries no literal', () => {
  const air = mediumById('air');
  const g = air.gravityMps2;
  assert.ok(hop.includes(`gravity="${f(g[0])} ${f(g[1])} ${f(g[2])}"`), 'the <option> gravity is the medium\'s');
  assert.ok(!hop.includes('density=') && !hop.includes('viscosity='), 'no fluid model (ADR-160 D7)');
  const src = fs.readFileSync(SOURCE, 'utf8');
  assert.ok(!/9\.8\d*/.test(src), 'no 9.81 typed in the generator');
  assert.throws(() => gen.hexapodMjcf(spec.SPIDER_18, spec.BRIEF_MASSES, { medium: mediumById('seawater') }),
    (e) => e.refusal === 'model_not_valid_in_medium: rigid-body-plant, seawater', 'the spider declines seawater by name, as the hull and the drone do');
});

test('the spring piston and its latch exist only under latched-spring, sized from the contract', () => {
  assert.ok(!hop.includes('spring'), 'legs-hop has no spring at all');
  assert.ok(!hop.includes('<equality>'));
  const slide = jointLine(sprung, 'spring');
  assert.ok(slide && attr(slide, 'type') === 'slide' && attr(slide, 'axis') === '0 0 1', 'a slide joint along body z');
  assert.equal(attr(slide, 'stiffness'), f(spec.SPIDER_18.spring.stiffnessNPerM));
  const stroke = spec.SPIDER_18.spring.strokeMm / 1000;
  assert.equal(attr(slide, 'range'), `${f(-stroke)} ${f(stroke)}`);
  const latch = sprung.split('\n').find((l) => l.includes('<joint name="spring-latch"'));
  assert.ok(latch && attr(latch, 'joint1') === 'spring' && attr(latch, 'active') === 'true', 'the latch holds the slide');
  assert.equal(attr(latch, 'polycoef').split(' ')[0], f(stroke), 'held wound at +stroke');
  assert.ok(sprung.includes('<equality>') && sprung.includes('name="spring-rod"'));
  assert.equal(gen.hexapodPlant().spring.storedJ, spec.SPIDER_18.spring.storedJ);
});

test('IMU and LiDAR sites, the sensors, the floor, the body at its stand height, the stand height in <custom>', () => {
  const lay = spec.SPIDER_18.layout;
  for (const xml of [hop, sprung]) {
    assert.ok(xml.includes('<site name="imu" pos="0 0 0"'), 'IMU at the body centre');
    assert.ok(xml.includes(`<site name="lidar" pos="${f(lay.lidarNoseXMm / 1000)} 0 ${f(lay.lidarPlaneZMm / 1000)}"`), 'LiDAR on the nose, on the mid-plane');
    for (const s of ['<gyro name="gyro" site="imu"/>', '<accelerometer name="accel" site="imu"/>', '<framequat name="imu-quat" objtype="site" objname="imu"/>']) assert.ok(xml.includes(s), s);
    assert.ok(xml.includes('<geom name="floor" class="floor" type="plane"'));
    assert.ok(xml.includes(`<body name="body" pos="0 0 ${f(lay.standHeightMm / 1000)}"`));
    assert.ok(xml.includes(`<numeric name="standHeightM" data="${f(lay.standHeightMm / 1000)}"/>`));
    assert.ok(xml.includes('<compiler angle="radian"'));
    for (const leg of spec.LEG_IDS) assert.ok(xml.includes(`<geom name="${leg}-foot" class="foot" type="sphere"`), `${leg} foot`);
  }
});

test('the plant numbers are the contract\'s and the mass model\'s', () => {
  const p = gen.hexapodPlant();
  const lay = spec.SPIDER_18.layout;
  assert.equal(p.links.coxaM, lay.coxaMm / 1000); assert.equal(p.links.femurM, lay.femurMm / 1000);
  assert.equal(p.links.footCentreM, (lay.tibiaMm - lay.footRadiusMm) / 1000); assert.equal(p.links.footRadiusM, lay.footRadiusMm / 1000);
  assert.equal(p.body.massKg, spec.BRIEF_MASSES.bodyG / 1000);
  assert.ok(Math.abs(p.allUpKg - spec.allUpMassG(spec.BRIEF_MASSES) / 1000) < 1e-12);
  assert.ok(p.body.izz > p.body.ixx && p.body.ixx > 0, 'a flat body spins hardest about z');
  const heavier = gen.hexapodPlant(spec.SPIDER_18, { ...spec.BRIEF_MASSES, bodyG: 1055 });
  assert.equal(heavier.body.massKg, 1.055, 'another mass model changes the body, not the contract');
  assert.ok(gen.hexapodMjcf(spec.SPIDER_18, { ...spec.BRIEF_MASSES, bodyG: 1055 }).includes('mass="1.055"'));
});

test('the Python mirror fixture is exactly what invertedJointTargets produces', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'spider-18-mirror.json'), 'utf8'));
  assert.deepEqual(fx.actuatorOrder, spec.ACTUATOR_ORDER);
  assert.deepEqual(fx.mirror, Object.fromEntries(spec.LEG_IDS.map((leg) => [leg, spec.mirrorLegRole(leg)])));
  assert.ok(fx.cases.length >= 3);
  for (const c of fx.cases) {
    const got = spec.invertedJointTargets(c.targets);
    assert.equal(got.length, 18);
    got.forEach((v, i) => assert.ok(Math.abs(v - c.expected[i]) < 1e-9, `${c.name}[${i}] ${v} vs ${c.expected[i]}`));
  }
  assert.throws(() => spec.invertedJointTargets(new Array(17).fill(0)), /expected 18/);
});

test('the fixtures on disk are what the generator emits, byte for byte', () => {
  for (const [jump, xml] of [['legs-hop', hop], ['latched-spring', sprung]]) {
    const disk = fs.readFileSync(path.join(FIXTURES, `spider-18-${jump}.xml`), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(disk, xml, `regenerate engine/tests/fixtures/spider-18-${jump}.xml when the generator or the contract changes`);
  }
  assert.equal(gen.jumpOptionById(undefined), 'legs-hop'); assert.equal(gen.jumpOptionById('latched-spring'), 'latched-spring'); assert.equal(gen.jumpOptionById('rocket'), null);
});

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
function mount(checkHexapod, certifyHexapod = () => ({})) {
  const router = fakeRouter();
  const calls = []; const certifies = []; const remembered = [];
  routes.registerHexapodPhysicsRoutes(router, {
    withSub: (_req, _res) => 'operator',
    checkHexapod: async (input) => { calls.push(input); return checkHexapod(input); },
    certifyHexapod: async (input) => { certifies.push(input); return certifyHexapod(input); },
    rememberCertified: (sub, policyFile, certificate) => { remembered.push({ sub, policyFile, ok: certificate.ok }); },
    physicsFailure: (error) => ({ status: 503, body: { error: 'physics_unavailable', code: error.code, reason: error.reason ?? null, installHint: 'install-engine.sh' } }),
  });
  return { router, calls, certifies, remembered };
}

test('GET /physics/hexapod/mjcf hands out the model for a jump option and refuses an unknown fit or jump', async () => {
  const { router } = mount(() => ({}));
  const get = router.handlers['GET /physics/hexapod/mjcf'];
  let res = fakeRes(); get({ query: { jump: 'latched-spring' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.headers['Content-Type'], 'application/xml; charset=utf-8'); assert.equal(res.body, sprung);
  res = fakeRes(); get({ query: {} }, res);
  assert.equal(res.body, hop, 'legs-hop by default');
  res = fakeRes(); get({ query: { jump: 'rocket' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'unknown_jump'); assert.deepEqual(res.body.jumps, spec.SPIDER_18.jumpOptions);
  res = fakeRes(); get({ query: { fit: 'spider-24' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'unknown_fit');
});

test('POST /physics/hexapod/check sends one generated model to the engine and answers what it measured beside the contract', async () => {
  const report = { task: 'hexapod-check', seeds: 1, models: [{ jump: 'latched-spring', hasSpring: true, verdict: { standsAtStandHeight: true } }], wallSeconds: 1.2, reportFiles: ['hexapod-check-latched-spring-seed0.json'] };
  const { router, calls } = mount(() => report);
  const post = router.handlers['POST /physics/hexapod/check'];
  const res = fakeRes();
  await post({ body: { fit: 'spider-18', seeds: 1, jump: 'latched-spring' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].seeds, 1); assert.equal(calls[0].models.length, 1);
  assert.equal(calls[0].models[0].jump, 'latched-spring'); assert.equal(calls[0].models[0].mjcf, sprung);
  assert.equal(res.body.simulated, true); assert.equal(res.body.fit, 'spider-18'); assert.equal(res.body.jump, 'latched-spring');
  assert.deepEqual(res.body.report, report);
  assert.equal(res.body.contract.standHeightM, spec.SPIDER_18.layout.standHeightMm / 1000);
  assert.equal(res.body.contract.spring.storedJ, spec.SPIDER_18.spring.storedJ);
  assert.deepEqual(res.body.contract.actuators, spec.ACTUATOR_ORDER);
  const bare = fakeRes();
  await post({ body: {} }, bare);
  assert.equal(bare.statusCode, 200); assert.equal(bare.body.jump, 'legs-hop'); assert.equal(bare.body.seeds, routes.HEXAPOD_CHECK_SEEDS.fallback); assert.equal(bare.body.contract.spring, null);
});

test('the check refuses a bad seed count, an unknown jump or fit, and answers an engine that is down with the tile\'s 503', async () => {
  const { router, calls } = mount(() => { throw new EngineFailure('capability_unavailable', 'the physics engine is unavailable', 'connect ECONNREFUSED'); });
  const post = router.handlers['POST /physics/hexapod/check'];
  for (const [body, error] of [[{ seeds: 9 }, 'bad_seeds'], [{ seeds: 0 }, 'bad_seeds'], [{ jump: 'rocket' }, 'unknown_jump'], [{ fit: 'nope' }, 'unknown_fit']]) {
    const res = fakeRes();
    await post({ body }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body)); assert.equal(res.body.error, error);
  }
  assert.equal(calls.length, 0, 'nothing reached the engine');
  const down = fakeRes();
  await post({ body: { seeds: 2 } }, down);
  assert.equal(down.statusCode, 503); assert.equal(down.body.error, 'physics_unavailable'); assert.equal(down.body.code, 'capability_unavailable');
  assert.ok(down.body.installHint, 'the install command is named');
});

test('the check\'s timeout allows the simulation it runs; the seed band is the arm\'s', () => {
  assert.ok(routes.HEXAPOD_CHECK_TIMEOUT_MS >= 120000);
  assert.deepEqual(routes.HEXAPOD_CHECK_SEEDS, { min: 1, max: 5, fallback: 1 });
});

test('POST /physics/hexapod/certify sends the report and the design\'s continuous torque to the gate, remembers the certificate for the owner, and refuses a missing or pathed file before the engine', async () => {
  const cert = { task: 'hexapod-certify', ok: true, checked: 1631, refused: [], refusedCount: 0, policyFile: 'hexapod-walk-ppo-shape-seed0.zip', reportFile: 'hexapod-walk-shape-seed0.json', policyBeatsBaseline: true, limits: { continuousNm: 1.47, stallNm: 2.942 }, mode: 'shape', unit: 'control steps' };
  const { router, certifies, remembered } = mount(() => ({}), () => cert);
  const post = router.handlers['POST /physics/hexapod/certify'];
  let res = fakeRes(); await post({ body: { file: ' hexapod-walk-shape-seed0.json ' } }, res);
  assert.equal(res.statusCode, 200);
  const usable = Math.min(...design.buildHexapod('spider-18').joints.map((j) => j.usableNm));
  assert.deepEqual(certifies, [{ file: 'hexapod-walk-shape-seed0.json', continuousNm: usable }], 'the limit is the design\'s usable (continuous) torque, never a literal');
  assert.equal(routes.continuousTorqueNm(), usable);
  assert.ok(usable > 0 && usable < servoSpecFrom(servoRow(spec.SPIDER_18.servoRowId)).stallNm, 'continuous sits under the stall');
  assert.deepEqual(res.body, { file: 'hexapod-walk-shape-seed0.json', policyFile: cert.policyFile, beatsBaseline: true, limits: cert.limits, certification: cert });
  assert.deepEqual(remembered, [{ sub: 'operator', policyFile: cert.policyFile, ok: true }]);
  res = fakeRes(); await post({ body: {} }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'file_required');
  res = fakeRes(); await post({ body: { file: '../hexapod-walk-shape-seed0.json' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'bad_file');
  res = fakeRes(); await post({ body: { file: 'hover-leg-seed0.json' } }, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.error, 'bad_file', 'only a hexapod report');
  assert.equal(certifies.length, 1, 'a refused name never reaches the engine');
});

test('the gate\'s own refusals answer by name with their status and remember nothing; an engine that is down is the tile\'s 503', async () => {
  const refusing = (code) => () => { throw new EngineFailure('engine_error', 'physics engine hexapod.certify failed', `because ${code}`, code); };
  for (const [code, status] of [['report_not_found', 404], ['policy_not_found', 404], ['no_policy', 422], ['bad_task', 422], ['bad_request', 400]]) {
    const { router, remembered } = mount(() => ({}), refusing(code));
    const res = fakeRes(); await router.handlers['POST /physics/hexapod/certify']({ body: { file: 'hexapod-walk-shape-seed0.json' } }, res);
    assert.equal(res.statusCode, status, code); assert.equal(res.body.error, code); assert.equal(res.body.message, `because ${code}`); assert.equal(res.body.file, 'hexapod-walk-shape-seed0.json');
    assert.equal(remembered.length, 0);
  }
  const unnamed = mount(() => ({}), () => { throw new EngineFailure('engine_error', 'physics engine hexapod.certify failed', 'a refusal the route does not name', 'no_report_dir'); });
  let res = fakeRes(); await unnamed.router.handlers['POST /physics/hexapod/certify']({ body: { file: 'hexapod-walk-shape-seed0.json' } }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'physics_unavailable');
  const down = mount(() => ({}), () => { throw new EngineFailure('capability_unavailable', 'the physics engine is unavailable', 'connect ECONNREFUSED'); });
  res = fakeRes(); await down.router.handlers['POST /physics/hexapod/certify']({ body: { file: 'hexapod-walk-shape-seed0.json' } }, res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'capability_unavailable'); assert.equal(res.body.installHint, 'install-engine.sh');
  assert.ok(routes.HEXAPOD_CERTIFY_TIMEOUT_MS >= 60000, 'the gate replays tens of seconds of simulation');
  assert.ok(new EngineFailure('engine_error', 'm', 'r', 'report_not_found').refusal === 'report_not_found', 'the bridge client carries the engine\'s refusal code');
});
