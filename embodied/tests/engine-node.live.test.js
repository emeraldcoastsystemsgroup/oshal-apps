/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The real plant on the rail (B20): the Python engine bridge is started as a node (EMBODIED_PYTHON names an interpreter with the requirements pins; OSHAL_CORE_DIR a framework checkout) pointed at the real package routes on loopback — it heartbeats into /api/embodied/nodes/heartbeat under a secret minted for the run, the fleet lists it online with the package's own engine tree hash, an owner's world is reset onto it, and a drone-first exploration runs to done on MuJoCo through every unchanged guard, every step a command envelope to the node. Without the interpreter it does not run and says so.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The node carries its owner (EMBODIED_NODE_OWNER_SUB) as the trusted service user sub; the fleet records it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const PYTHON = process.env.EMBODIED_PYTHON;
const CORE_OK = (() => { try { require('./routes.harness'); return true; } catch { return false; } })();
const SKIP = !PYTHON ? 'EMBODIED_PYTHON not set — the live node suite needs a python with the engine pins' : !CORE_OK ? 'OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout' : false;

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the MuJoCo plant joins the rail by heartbeat and the sim explores on it through the real routes', { skip: SKIP, timeout: 600000 }, async () => {
  const { loadRoutes, fakePool, PKG } = require('./routes.harness');
  const { E } = require('./helpers');
  const { trustedSubMirror } = require('./routes.harness');
  const { express, createEmbodiedRoutes, createEmbodiedNodeRoutes, restore } = loadRoutes();
  const secret = randomBytes(16).toString('hex');
  const fleet = new E.DroneNodeFleet();
  let wall = 1_800_000_000_000;
  const pool = fakePool();
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/embodied/nodes', trustedSubMirror(), createEmbodiedNodeRoutes({ pool, appPackageDir: PKG }, { now: () => wall, fleet }));
  app.use((req, _res, next) => { req.oidc = { user: { sub: 'live-owner' }, isAuthenticated: () => true }; next(); });
  app.use('/api/embodied', createEmbodiedRoutes({ pool, appPackageDir: PKG }, { now: () => wall, noTimer: true, engineAddr: '127.0.0.1:1', fleet, serviceSecret: () => secret }));
  const server = await new Promise((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, init = {}) => { const res = await fetch(`${base}/api/embodied${p}`, init); const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; } return { status: res.status, body }; };
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const nodePort = await freePort(); const bridgePort = await freePort();
  const logs = [];
  const proc = spawn(PYTHON, [path.join(PKG, 'engine', 'container', 'embodied_engine_bridge.py'), '--host', '127.0.0.1', '--port', String(bridgePort)], {
    env: { ...process.env, SWARM_SERVICE_SECRET: secret, OSHAL_API_URL: base, EMBODIED_NODE_ID: 'plant-live', EMBODIED_NODE_HOST: '127.0.0.1', EMBODIED_NODE_PORT: String(nodePort), EMBODIED_NODE_ENDPOINT: `http://127.0.0.1:${nodePort}`, EMBODIED_NODE_OWNER_SUB: 'live-owner', PYTHONUTF8: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => logs.push(String(d))); proc.stderr.on('data', (d) => logs.push(String(d)));
  try {
    let row = null;
    for (let i = 0; i < 120 && !(row && row.online); i += 1) { await sleep(500); row = (await call('/physics/status')).body.nodes.find((n) => n.nodeId === 'plant-live') ?? null; if (proc.exitCode !== null) break; }
    assert.ok(row && row.online, `the plant heartbeat in: ${JSON.stringify(row)}\n${logs.join('')}`);
    assert.equal(row.engine, 'mujoco'); assert.equal(row.protocol, E.BRIDGE_PROTOCOL);
    assert.equal(row.stale, false, 'the running engine tree is this package\'s');
    assert.equal(row.endpointUrl, `http://127.0.0.1:${nodePort}`);
    assert.equal(row.ownerSub, 'live-owner', 'the node carried its owner as the trusted service user sub');
    const reset = await call('/world/reset', json('POST', { backend: 'node', node: 'plant-live', sensorSet: 'recon-mini', seed: 5 }));
    assert.equal(reset.status, 200, JSON.stringify(reset.body).slice(0, 400));
    assert.equal(reset.body.drone.backend, 'node'); assert.equal(reset.body.drone.plant.engine, 'mujoco');
    assert.deepEqual(reset.body.drone.node, { nodeId: 'plant-live', link: 'rail', endpoint: `http://127.0.0.1:${nodePort}` });
    const d = await call('/tasks/draft', json('POST', { task: 'explore', maxScans: 4, droneFirst: true }));
    assert.equal(d.status, 201, JSON.stringify(d.body).slice(0, 400));
    assert.equal(d.body.rehearsal.ok, true, d.body.rehearsal.issues.join('; '));
    assert.equal((await call(`/tasks/${d.body.task_id}/execute`, json('POST', { confirm: true }))).status, 200);
    let last = null;
    for (let i = 0; i < 7000; i += 1) { wall += 200; last = (await call('/state')).body; if (last.control.executor !== 'running' && i > 1) break; }
    assert.equal(last.control.executor, 'done', JSON.stringify(last.control));
    assert.equal(last.drone.backend, 'node'); assert.equal(last.drone.mode, 'landed'); assert.equal(last.drone.down, null);
    assert.ok(last.world.stats.knownFraction > 0.2, `known ${last.world.stats.knownFraction}`);
    const health = await fetch(`http://127.0.0.1:${nodePort}/health`).then((r) => r.json());
    assert.ok(health.ok && health.heartbeats.acked > 0 && health.heartbeats.lastStatus === 200, JSON.stringify(health));
    const seen = (await call('/physics/status')).body.nodes.find((n) => n.nodeId === 'plant-live');
    assert.ok(seen.telemetry && typeof seen.telemetry.z === 'number', 'the latest telemetry rode the heartbeat');
    assert.equal((await call('/world/reset', json('POST', { backend: 'kinematic' }))).status, 200, 'the world is dropped from the node');
  } finally {
    proc.kill(); await sleep(300);
    await new Promise((r) => server.close(r));
    restore();
  }
});
