/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The worker-thread half of the node double: an HTTP node on loopback speaking the rail exactly as the Python node front does — the swarm service secret on /api/drone-node/command, {id, command, args} envelopes over FakePlant sessions, a heartbeat pusher with the same body shape — so the rail client, the fleet and the routes are proven end to end over a real socket. It lives in a worker because the simulation blocks the main thread on each command (Atomics.wait); a node on the same event loop would deadlock, which is exactly why the real node is another process.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The owner rides as the trusted service user-sub header, exactly as the Python front sends it.
 */
'use strict';
const http = require('node:http');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { FakePlant } = require('./fake-plant');

const E = require(path.join(__dirname, '..', 'routes', 'engine', 'index.js'));
const cfg = { kind: 'plant', engine: 'fake', version: '0', buildHash: 'fake-build', refuseClone: false, apiUrl: null, heartbeatMs: 200, ownerSub: null, ...workerData };
const probe = new E.WorldSim({ sensorSet: E.RECON_MINI });
const solids = probe.sensingSolids();
const home = probe.scene.droneHome;
const sessions = new Map();
const events = [];
let seq = 0; let ack = 0; let last = null; let heartbeating = Boolean(cfg.apiUrl); let endpointUrl = '';
const stats = { commands: 0, heartbeats: 0, acks: 0 };

const event = (kind, text) => { seq += 1; events.push({ seq, at: new Date(0).toISOString(), kind, text }); if (events.length > 100) events.splice(0, events.length - 100); };
const get = (id) => { const p = sessions.get(id); if (!p) throw new Error(`no session ${id}: load it first`); return p; };

function handle(command, args) {
  stats.commands += 1;
  switch (command) {
    case 'status': return { sessions: sessions.size, protocol: 1, engine: cfg.engine, version: cfg.version, buildHash: cfg.buildHash };
    case 'load': {
      const controller = args.controller && args.controller.kind === 'policy' ? `policy:${args.controller.file}` : 'pid';
      sessions.set(args.session, new FakePlant(solids, home, { seed: args.seed ?? 0, controller }));
      event('load', args.session);
      return { session: args.session, bodies: 1, geoms: solids.length, actuators: 4, timestep: 0.002, massKg: 0.746, restZ: 0.03, controller: args.controller ?? { kind: 'pid' } };
    }
    case 'step': {
      const r = get(args.session).step(args.setpoint, args.phase, args.dt);
      last = { session: args.session, phase: args.phase, x: r.pose.x, y: r.pose.y, z: r.pose.z, yaw: r.pose.yaw, tiltRad: r.tiltRad, speed: r.speed, contact: r.contact, settled: r.settled };
      if (r.contact) event('contact', `${args.session} touched ${r.contact}`);
      return { x: r.pose.x, y: r.pose.y, z: r.pose.z, yaw: r.pose.yaw, tiltRad: r.tiltRad, speed: r.speed, contact: r.contact, settled: r.settled, motorsN: r.motorsN };
    }
    case 'sense': return get(args.session).sense(args.spec || {});
    case 'clone': {
      if (cfg.refuseClone) throw new Error('cannot_clone: this node is one body');
      sessions.set(args.session, get(args.from).clone());
      event('clone', args.session);
      return { session: args.session };
    }
    case 'drop': sessions.delete(args.session); event('drop', args.session); return { dropped: true };
    case 'reports': return { dir: '/nowhere', reports: [], policies: [] };
    default: throw new Error(`unknown command ${command}`);
  }
}

const send = (res, code, payload) => { const data = Buffer.from(JSON.stringify(payload)); res.writeHead(code, { 'content-type': 'application/json', 'content-length': data.length }); res.end(data); };

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { send(res, 200, { ok: true, nodeId: cfg.nodeId, kind: cfg.kind, ...stats }); return; }
  if (req.method !== 'POST' || req.url !== '/api/drone-node/command') { send(res, 404, { error: 'not_found' }); return; }
  if ((req.headers['x-service-secret'] || '') !== cfg.secret) { send(res, 401, { error: 'service_secret_required', reason: 'a command needs the swarm service secret' }); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let id = null;
    try {
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      id = envelope.id ?? null;
      send(res, 200, { id, ok: true, result: handle(envelope.command, envelope.args || {}) });
    } catch (err) { send(res, 200, { id, ok: false, error: err.name, reason: err.message }); }
  });
});

async function heartbeat() {
  if (!heartbeating || !cfg.apiUrl) return;
  stats.heartbeats += 1;
  const body = { nodeId: cfg.nodeId, kind: cfg.kind, endpointUrl, protocol: 1, engine: cfg.engine, version: cfg.version, buildHash: cfg.buildHash, sessions: sessions.size, telemetry: last, events: events.filter((e) => e.seq > ack) };
  try {
    // The owner rides as the trusted service user-sub header, exactly as the Python front sends it.
    const owner = cfg.ownerSub ? { 'x-oshal-user-sub-b64': Buffer.from(cfg.ownerSub, 'utf8').toString('base64url') } : {};
    const res = await fetch(`${cfg.apiUrl}/api/embodied/nodes/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-secret': cfg.secret, ...owner }, body: JSON.stringify(body) });
    const reply = await res.json().catch(() => ({}));
    if (res.ok && Number.isInteger(reply.ack)) { ack = reply.ack; stats.acks += 1; }
    parentPort.postMessage({ type: 'heartbeat', status: res.status, ack });
  } catch (err) { parentPort.postMessage({ type: 'heartbeat', status: 0, error: err.message }); }
}

server.listen(0, '127.0.0.1', () => {
  endpointUrl = `http://127.0.0.1:${server.address().port}`;
  parentPort.postMessage({ type: 'listening', port: server.address().port, endpointUrl });
  if (cfg.apiUrl) setInterval(() => { void heartbeat(); }, cfg.heartbeatMs).unref();
  void heartbeat();
});

parentPort.on('message', (m) => {
  if (m === 'stop-heartbeat') heartbeating = false;
  else if (m === 'start-heartbeat') heartbeating = true;
  else if (m === 'heartbeat-now') void heartbeat();
  else if (m === 'stats') parentPort.postMessage({ type: 'stats', ...stats, sessions: sessions.size });
  else if (m === 'close') server.close(() => process.exit(0));
});
