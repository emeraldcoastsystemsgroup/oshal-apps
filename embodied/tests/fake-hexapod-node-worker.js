/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-202 (lane L4): the worker-thread half of the spider-18 node double. Role `node`: an HTTP node on loopback speaking the hexapod rail exactly as engine/container/embodied_hexapod_node.py does — the command key on /api/drone-node/command, {id, command, args} envelopes, the brief's section 3.2 state plus the node's status on every reply, refusals as {error: code, reason: "code: because"} — over a kinematic stand-in (the body integrates the walk command, a flip lasts its 3.6 s, a sit relaxes after a second, jump is no_spring without a spring). Role `api`: a fake controller api that answers the heartbeat of a REAL Python node with its command key, so the suite can drive the real node over a real socket. In a worker because the seam blocks the main thread on each command (Atomics.wait). Not a test file: the store-ci glob is engine-*.test.js.
 */
'use strict';
const http = require('node:http');
const { parentPort, workerData } = require('node:worker_threads');

const cfg = { role: 'node', nodeId: 'fake-hexapod', kind: 'hexapod', hasSpring: true, tickHz: 50, buildHash: 'fake-hexapod-build', credential: null, commandKey: null, ...workerData };
const ACTUATORS = 18;
const LEGS = 6;
const G = 9.81;
const FLIP_S = 3.6;
const SIT_S = 1.0;
const COMMANDS = ['hello', 'status', 'walk', 'stop', 'pose', 'flip', 'jump', 'sense', 'sit', 'land', 'estop', 'tick', 'load', 'reset'];
const stats = { commands: 0, serviceSecretSeen: false, heartbeats: 0 };

const named = (name, message) => { const e = new Error(message); e.name = name; return e; };
const refusal = (code, because) => named(code, `${code}: ${because}`);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const zeros = (n) => new Array(n).fill(0);

/** The kinematic stand-in: the Python fake body and controller folded into one, the same reply shapes. */
class Double {
  constructor() {
    this.time = 0; this.pos = [0, 0, 0.09]; this.yaw = 0; this.vel = [0, 0, 0]; this.joints = zeros(ACTUATORS);
    this.mode = 'idle'; this.command = { vxMps: 0, vyMps: 0, yawRateRadS: 0 }; this.ticks = 0; this.inverted = false;
    this.relaxed = false; this.flip = null; this.flipLeft = 0; this.sitLeft = 0; this.flips = 0;
  }
  hello() { return { protocol: 1, engine: 'hexapod-fake', version: '0.1.0', buildHash: cfg.buildHash, backend: 'fake', kind: cfg.kind, tickHz: cfg.tickHz, hasSpring: cfg.hasSpring }; }
  status() {
    return { mode: this.mode, inverted: this.inverted, mirrored: this.inverted, accelZ: this.inverted ? -G : G, flips: this.flips, command: { ...this.command },
      tickHz: cfg.tickHz, ticks: this.ticks, backend: 'fake', relaxed: this.relaxed, flip: this.flip };
  }
  state() {
    return { timeS: Number(this.time.toFixed(4)), bodyPosM: [...this.pos], bodyQuatWXYZ: [Math.cos(this.yaw / 2), 0, 0, Math.sin(this.yaw / 2)], bodyVelMps: [...this.vel],
      gyroRadS: [0, 0, this.mode === 'walk' ? this.command.yawRateRadS : 0], accelMps2: [0, 0, this.inverted ? -G : G], jointPosRad: [...this.joints], jointVelRadS: zeros(ACTUATORS),
      jointTorqueNm: zeros(ACTUATORS), footContact: new Array(LEGS).fill(true), inverted: this.inverted, fell: false, spring: cfg.hasSpring ? { storedJ: 3.61, latched: false } : null };
  }
  reply(extra = {}) { return { ...this.state(), node: this.status(), ...extra }; }
  busy(because = 'a flip is in progress; wait for it to finish') { if (this.mode === 'flip') throw refusal('busy', because); }
  still() { this.command = { vxMps: 0, vyMps: 0, yawRateRadS: 0 }; }
  tick(dt) {
    if (this.mode === 'walk') {
      const { vxMps, vyMps, yawRateRadS } = this.command;
      const c = Math.cos(this.yaw); const s = Math.sin(this.yaw);
      this.vel = [vxMps * c - vyMps * s, vxMps * s + vyMps * c, 0];
      this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.yaw += yawRateRadS * dt;
    } else { this.vel = [0, 0, 0]; }
    if (this.mode === 'flip') { this.flipLeft -= dt; if (this.flipLeft <= 1e-9) { this.mode = 'idle'; this.flip = null; } }
    if (this.mode === 'sit') { this.sitLeft -= dt; if (this.sitLeft <= 1e-9) this.relaxed = true; }
    this.ticks += 1; this.time += dt;
    return this.reply();
  }
}

/** Each command's handler: (double, args) → the reply payload, or a throw shaped as the Python node's. */
const OPS = {
  hello: (d) => d.hello(),
  status: (d) => ({ ...d.hello(), ...d.status(), sessions: 1 }),
  walk: (d, a) => {
    d.busy();
    for (const k of ['vxMps', 'vyMps', 'yawRateRadS']) if (!finite(a[k] ?? 0)) throw named('ValueError', `${k} must be a finite number`);
    d.relaxed = false; d.command = { vxMps: a.vxMps ?? 0, vyMps: a.vyMps ?? 0, yawRateRadS: a.yawRateRadS ?? 0 }; d.mode = 'walk';
    return d.reply();
  },
  stop: (d) => { d.still(); if (d.mode !== 'flip') d.mode = 'idle'; return d.reply(); },
  pose: (d, a) => {
    d.busy();
    if (!Array.isArray(a.targetsRad) || a.targetsRad.length !== ACTUATORS || !a.targetsRad.every(finite)) throw named('ValueError', `targetsRad must be a list of ${ACTUATORS} numbers in ACTUATOR_ORDER`);
    d.relaxed = false; d.still(); d.joints = [...a.targetsRad]; d.mode = 'pose';
    return d.reply();
  },
  flip: (d, a) => {
    const side = a.side ?? 'right';
    if (side !== 'left' && side !== 'right') throw named('ValueError', "flip side must be 'left' or 'right'");
    d.busy('a flip is already in progress');
    d.relaxed = false; d.still(); d.mode = 'flip'; d.flipLeft = FLIP_S;
    d.flip = { side, durationS: FLIP_S, keyframes: 4, fromInverted: d.inverted };
    return d.reply({ flip: d.flip });
  },
  jump: (d) => { d.busy(); if (!cfg.hasSpring) throw refusal('no_spring', 'this body has no latched spring (legs-hop only)'); d.relaxed = false; return d.reply({ jumped: true }); },
  sense: (d) => d.reply({ lidar: { anglesRad: [], rangesM: [] }, lidarSource: 'none' }),
  sit: (d) => { d.busy(); d.still(); d.mode = 'sit'; d.sitLeft = SIT_S; return d.reply(); },
  land: (d) => OPS.sit(d),
  estop: (d) => { d.still(); d.mode = 'estop'; d.flip = null; d.relaxed = true; return d.reply({ estopped: true }); },
  tick: (d, a) => {
    const dt = a.dtS === undefined ? 1 / cfg.tickHz : a.dtS;
    if (!finite(dt) || dt <= 0 || dt > 1) throw named('ValueError', 'dtS must be in (0, 1]');
    return d.tick(dt);
  },
  reset: (d, a) => { d.inverted = a.pose === 'inverted'; d.pos = [0, 0, 0.09]; d.yaw = 0; d.mode = 'idle'; d.flip = null; d.still(); return d.reply(); },
  load: (d, a) => OPS.reset(d, a),
};

const double = new Double();

function handle(envelope) {
  const command = envelope.command; const args = envelope.args;
  if (typeof command !== 'string' || args === null || typeof args !== 'object' || Array.isArray(args)) throw named('ValueError', 'an envelope is {id, command, args}');
  if (!COMMANDS.includes(command)) throw named('ValueError', `unknown command '${command}'; the hexapod answers ${COMMANDS.join(', ')}`);
  stats.commands += 1;
  return OPS[command](double, args);
}

const send = (res, code, payload) => { const data = Buffer.from(JSON.stringify(payload)); res.writeHead(code, { 'content-type': 'application/json', 'content-length': data.length }); res.end(data); };
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });

let commandKey = cfg.commandKey;

/** The node role: /health and the command endpoint under the command key. */
async function serveNode(req, res) {
  if (req.method === 'GET' && req.url === '/health') { send(res, 200, { ok: true, nodeId: cfg.nodeId, kind: cfg.kind, credential: true, commandKey: Boolean(commandKey), ...double.hello(), ...stats }); return; }
  if (req.method !== 'POST' || req.url !== '/api/drone-node/command') { send(res, 404, { error: 'not_found' }); return; }
  if (req.headers['x-service-secret'] !== undefined) stats.serviceSecretSeen = true;
  if (!commandKey || (req.headers['x-node-command-key'] || '') !== commandKey) { send(res, 401, { error: 'command_key_required', reason: "a command needs the key from this node's last heartbeat reply" }); return; }
  const text = await readBody(req);
  let id = null;
  try {
    const envelope = JSON.parse(text);
    id = envelope.id ?? null;
    send(res, 200, { id, ok: true, result: handle(envelope) });
  } catch (err) { send(res, 200, { id, ok: false, error: err.name, reason: err.message }); }
}

/** The api role: the heartbeat endpoint a real Python node pushes to; it answers the key it was given and reports every beat. */
async function serveApi(req, res) {
  if (req.method !== 'POST' || req.url !== '/api/embodied/nodes/heartbeat') { send(res, 404, { error: 'not_found' }); return; }
  const text = await readBody(req);
  if (req.headers.authorization !== `Bearer ${cfg.credential}`) { send(res, 401, { error: 'a device credential is required' }); return; }
  let body = {};
  try { body = JSON.parse(text); } catch { send(res, 400, { error: 'unreadable' }); return; }
  stats.heartbeats += 1;
  const ack = Math.max(0, ...(Array.isArray(body.events) ? body.events.map((e) => Number(e.seq) || 0) : [0]));
  send(res, 200, { ok: true, nodeId: body.nodeId, ack, commandKey: cfg.commandKey });
  parentPort.postMessage({ type: 'heartbeat', body });
}

const server = http.createServer((req, res) => { void (cfg.role === 'api' ? serveApi(req, res) : serveNode(req, res)); });

server.listen(0, '127.0.0.1', () => {
  parentPort.postMessage({ type: 'listening', port: server.address().port, endpointUrl: `http://127.0.0.1:${server.address().port}` });
});

parentPort.on('message', (m) => {
  if (m === 'stats') parentPort.postMessage({ type: 'stats', ...stats });
  else if (m === 'close') server.close(() => process.exit(0));
  else if (m && m.type === 'command-key') { commandKey = m.key; parentPort.postMessage({ type: 'command-key-set' }); }
});
