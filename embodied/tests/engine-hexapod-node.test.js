/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-202 (lane L4): the spider-18 seam without a robot or a container. The fleet mints a hexapod node on its heartbeat (kind hexapod is a NodeKind now) and its manifest validates; RailHexapodNode refuses a node holding another command key and a node of another kind before any walk, checks every argument before an envelope leaves, and over a real socket walks the node double (a worker speaking the Python rail's shapes): walk integrates, tick, sense carries the brief's state plus the LiDAR, the body's no_spring and the node's busy refusals come back typed, stop does not interrupt a flip, sit relaxes, estop holds, close fails closed. Then the REAL Python node (engine/container/embodied_hexapod_node.py, fake body) is spawned, heartbeats into a fake api for its command key, and answers the same seam over HTTP — and the double's reply shapes are diffed against the real node's, so the double cannot drift. The integration-boundary guard is that second test; the first is the branch logic.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The test credential is a plain placeholder: the public cut's gitleaks gate flagged the token-shaped one.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { E } = require('./helpers');
const { startFakeHexapodNode, startFakeNodeApi } = require('./fake-hexapod-node');

const T0 = 1_000_000;
const TOKEN = 'test-device-credential-hexapod-seam';  // a placeholder shape, never a real credential: the publish gate's entropy sweep must not read it as one
const KEY = 'k3y-' + 'h'.repeat(40);
const NODE_PY = path.join(__dirname, '..', 'engine', 'container', 'embodied_hexapod_node.py');
const STATE_KEYS = ['timeS', 'bodyPosM', 'bodyQuatWXYZ', 'bodyVelMps', 'gyroRadS', 'accelMps2', 'jointPosRad', 'jointVelRadS', 'jointTorqueNm', 'footContact', 'inverted', 'fell', 'spring'];
const NODE_KEYS = ['mode', 'inverted', 'mirrored', 'accelZ', 'flips', 'command', 'tickHz', 'ticks', 'backend', 'relaxed', 'flip'];
const WALK = { vxMps: 0.1, vyMps: 0, yawRateRadS: 0 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const keysOf = (o) => Object.keys(o).sort();

/** The brief's section 3.2 state plus the node's status: every key, the lengths. */
function assertReplyShape(r, label) {
  for (const k of STATE_KEYS) assert.ok(k in r, `${label}: state key ${k}`);
  for (const k of NODE_KEYS) assert.ok(k in r.node, `${label}: node key ${k}`);
  assert.equal(r.jointPosRad.length, 18); assert.equal(r.footContact.length, 6); assert.equal(r.bodyQuatWXYZ.length, 4); assert.equal(r.accelMps2.length, 3);
  assert.ok(r.spring === null || (typeof r.spring.storedJ === 'number' && typeof r.spring.latched === 'boolean'), `${label}: spring is {storedJ, latched} or null`);
}

/** Drive one connected spider through the brief's commands; the same script runs against the double and the real node. */
function driveSpider(spider, label) {
  const shapes = { hello: keysOf(spider.hello()) };
  assert.equal(spider.hello().kind, 'hexapod'); assert.equal(spider.hello().backend, 'fake'); assert.equal(spider.hello().hasSpring, false); assert.equal(spider.backend, 'fake');
  const walked = spider.walk(WALK);
  assert.equal(walked.node.mode, 'walk'); assert.deepEqual(walked.node.command, WALK); assertReplyShape(walked, `${label} walk`);
  shapes.walk = keysOf(walked); shapes.node = keysOf(walked.node);
  let last = walked;
  for (let i = 0; i < 50; i += 1) last = spider.tick(0.02);
  near(last.bodyPosM[0], 0.1, 1e-6, `${label}: 50 ticks of 20 ms at 0.1 m/s`); near(last.bodyPosM[1], 0, 1e-9); assert.equal(last.node.ticks >= 50, true);
  const sensed = spider.sense();
  assertReplyShape(sensed, `${label} sense`); assert.deepEqual(sensed.lidar, { anglesRad: [], rangesM: [] }); assert.equal(sensed.lidarSource, 'none');
  shapes.sense = keysOf(sensed);
  const posed = spider.pose(new Array(18).fill(0).map((_, i) => 0.1 * ((i % 3) - 1)));
  assert.equal(posed.node.mode, 'pose');
  assert.throws(() => spider.jump(), (e) => E.isNoSpring(e) && !E.isBusy(e) && e instanceof E.EngineFailure && e.code === 'engine_error', `${label}: a legs-hop body refuses jump with no_spring`);
  const flipped = spider.flip('left');
  assert.deepEqual(flipped.flip, { side: 'left', durationS: 3.6, keyframes: 4, fromInverted: false }); assert.equal(flipped.node.mode, 'flip');
  shapes.flip = keysOf(flipped);
  assert.throws(() => spider.flip(), (e) => E.isBusy(e) && !E.isNoSpring(e), `${label}: a second flip is busy`);
  assert.throws(() => spider.walk(WALK), E.isBusy, `${label}: a walk during a flip is busy`);
  assert.equal(spider.stop().node.mode, 'flip', `${label}: stop does not interrupt a flip`);
  for (let i = 0; i < 181; i += 1) last = spider.tick(0.02);
  assert.equal(last.node.mode, 'idle'); assert.equal(last.node.flip, null, `${label}: 3.6 s later the flip is over`);
  const sat = spider.sit();
  assert.equal(sat.node.mode, 'sit'); assert.equal(sat.node.relaxed, false);
  for (let i = 0; i < 51; i += 1) last = spider.tick(0.02);
  assert.equal(last.node.relaxed, true, `${label}: a second after sit the servos are relaxed`);
  assert.equal(spider.walk(WALK).node.relaxed, false, `${label}: a walk engages them again`);
  const stopped = spider.estop();
  assert.equal(stopped.estopped, true); assert.equal(stopped.node.mode, 'estop'); assert.equal(stopped.node.relaxed, true); assert.equal(stopped.node.flip, null);
  shapes.estop = keysOf(stopped);
  return shapes;
}

test('the fleet mints a hexapod node, the seam refuses the wrong key and another kind, checks arguments at home, and walks the double over a real socket', async () => {
  const node = await startFakeHexapodNode({ nodeId: 'spider-double', hasSpring: false });
  const drone = await startFakeHexapodNode({ nodeId: 'not-a-spider', kind: 'drone' });
  try {
    const fleet = new E.DroneNodeFleet({ endpointHosts: ['127.0.0.1'] });
    const { commandKey } = fleet.ingest(node.heartbeat(), T0);
    const record = fleet.get('spider-double', T0);
    assert.equal(record.kind, 'hexapod'); assert.equal(fleet.list(T0, 'other-tree').find((n) => n.nodeId === 'spider-double').stale, null, 'a hexapod is not held to the plant\'s engine tree');
    assert.deepEqual(E.validateManifest(E.SPIDER_18_MANIFEST).ok, true); assert.equal(E.SPIDER_18_MANIFEST.kind, 'hexapod'); assert.equal(E.actRequiresConfirm(E.SPIDER_18_MANIFEST, 'e-stop'), false);
    await node.acceptCommandKey('a-key-this-fleet-never-minted');
    assert.throws(() => E.RailHexapodNode.connect(record), (e) => e instanceof E.EngineFailure && e.code === 'capability_unavailable' && /command key/.test(e.reason), 'a node holding another key refuses before any walk');
    await node.acceptCommandKey(commandKey);
    const other = fleet.ingest({ ...drone.heartbeat(), kind: 'drone' }, T0);
    await drone.acceptCommandKey(other.commandKey);
    assert.throws(() => E.RailHexapodNode.connect(fleet.get('not-a-spider', T0)), (e) => e instanceof E.EngineFailure && /is not a hexapod \(kind drone/.test(e.message), 'a node of another kind is refused at connect');
    const spider = E.RailHexapodNode.connect(record);
    assert.equal(spider.link, 'rail'); assert.equal(spider.nodeId, 'spider-double'); assert.equal(spider.endpoint, node.endpointUrl);
    assert.ok(E.isHexapodNode(spider)); assert.equal(E.isHexapodNode(null), false); assert.equal(E.isHexapodNode({ nodeId: 'x', link: 'rail' }), false);
    const before = (await node.stats()).commands;
    assert.throws(() => spider.pose(new Array(17).fill(0)), (e) => e instanceof E.EngineFailure && e.code === 'engine_error' && /18/.test(e.reason), '17 targets never leave');
    assert.throws(() => spider.pose(new Array(18).fill(Number.NaN)), /18 finite targets/);
    assert.throws(() => spider.walk({ vxMps: 'fast', vyMps: 0, yawRateRadS: 0 }), /finite vxMps/);
    assert.throws(() => spider.walk({ vxMps: 0, vyMps: 0 }), /finite yawRateRadS/);
    assert.throws(() => spider.tick(2), /dtS must be in \(0, 1\]/); assert.throws(() => spider.tick(0), /dtS/);
    assert.throws(() => spider.flip('up'), /left' or 'right/);
    assert.equal((await node.stats()).commands, before, 'every refused argument was refused at home: no envelope left');
    const shapes = driveSpider(spider, 'double');
    assert.deepEqual(shapes.hello, ['backend', 'buildHash', 'engine', 'hasSpring', 'kind', 'protocol', 'tickHz', 'version']);
    spider.close();
    assert.throws(() => spider.stop(), (e) => e instanceof E.EngineFailure && e.code === 'capability_unavailable', 'a closed seam fails closed');
    spider.close();
    const stats = await node.stats();
    assert.equal(stats.serviceSecretSeen, false, 'the seam never sent the machine secret');
    assert.ok(stats.commands > 280, `the double answered ${stats.commands} envelopes`);
  } finally { await node.close(); await drone.close(); }
});

/** Spawn the real Python node on a fake body, heartbeating into `apiUrl`; resolves once it exits or is killed. */
function spawnRealNode(apiUrl) {
  const python = process.env.EMBODIED_PYTHON || 'python3';
  const env = { ...process.env, EMBODIED_HEXAPOD_BACKEND: 'fake', EMBODIED_HEXAPOD_SPRING: '0', EMBODIED_HEXAPOD_PACED: '0', EMBODIED_NODE_HOST: '127.0.0.1', EMBODIED_HEXAPOD_NODE_PORT: '0', EMBODIED_HEXAPOD_NODE_ID: 'spider-real', OSHAL_API_URL: apiUrl, EMBODIED_HEXAPOD_NODE_TOKEN: TOKEN };
  const child = spawn(python, [NODE_PY], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited, stderr: () => stderr };
}

test('the real Python node (fake body) heartbeats in, answers the seam over a real socket, and the double matches its reply shapes', async () => {
  const api = await startFakeNodeApi({ credential: TOKEN, commandKey: KEY });
  const double = await startFakeHexapodNode({ nodeId: 'spider-double', hasSpring: false });
  const real = spawnRealNode(api.url);
  try {
    const beat = await Promise.race([api.nextHeartbeat(20000), real.exited.then((x) => { throw new Error(`the python node exited early (${JSON.stringify(x)}):\n${real.stderr()}`); })]);
    const hb = beat.body;
    assert.equal(hb.kind, 'hexapod'); assert.equal(hb.engine, 'hexapod-fake'); assert.equal(hb.protocol, 1); assert.equal(hb.nodeId, 'spider-real'); assert.match(hb.endpointUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(hb.buildHash, /^[0-9a-f]{64}$/, 'the node reports the sha256 of its runtime files');
    const fleet = new E.DroneNodeFleet({ endpointHosts: ['127.0.0.1'] });
    fleet.ingest(hb, T0);
    const record = { ...fleet.get('spider-real', T0), commandKey: KEY };
    const spider = E.RailHexapodNode.connect(record, { timeoutMs: 10000 });
    assert.equal(spider.nodeId, 'spider-real'); assert.equal(spider.hello().buildHash, hb.buildHash);
    const realShapes = driveSpider(spider, 'real');
    spider.close();
    const { commandKey } = fleet.ingest(double.heartbeat(), T0);
    await double.acceptCommandKey(commandKey);
    const twin = E.RailHexapodNode.connect(fleet.get('spider-double', T0));
    const doubleShapes = driveSpider(twin, 'double');
    twin.close();
    assert.deepEqual(doubleShapes, realShapes, 'the double answers exactly the keys the real node answers (hello, walk, node status, sense, flip, estop)');
  } finally {
    real.child.kill('SIGTERM');
    await Promise.race([real.exited, new Promise((r) => setTimeout(r, 5000))]);
    if (real.child.exitCode === null) real.child.kill('SIGKILL');
    await double.close(); await api.close();
  }
});
