/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | RP-PUMP-01: behaviour and refusal guards for stopping the pumpkin mid-sentence across paired rooms (/rooms/stop), concierge/swarm (/stop), PumpkinFace.stop(), PumpkinAudio.forceStop() mid-synthesis, and projector stop-then-next-line recovery.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(PKG, 'routes');
const SERVICE_SECRET = 'test-stop-service-secret-0123456789';

class StubPresetService {
  async ensureSchema() {}
  async listPresets() { return [{ name: 'inflatable' }]; }
  async getPreset(_sub, name) { return name === 'inflatable' ? { name } : null; }
  async savePreset(_sub, name) { return { name }; }
  async deletePreset() { return true; }
  async getSettings() { return { activePreset: 'inflatable', mode: 'mimic' }; }
  async saveSettings() {}
}

class StubResponseService {
  async ensureSchema() {}
  async record(_sub, c) { return { id: 'r1', ...c }; }
  async list() { return []; }
  async get() { return null; }
  async setPinned() { return null; }
  async remove() { return false; }
  async markPlayed() {}
}

const authzShim = {
  hasValidServiceSecret(req) {
    const secret = String(process.env.SWARM_SERVICE_SECRET || '').trim();
    const provided = String(req.headers?.['x-service-secret'] || '').trim();
    return secret.length > 0 && provided.length === secret.length
      && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  },
  getTrustedServiceUserSub(req) {
    if (!authzShim.hasValidServiceSecret(req)) return null;
    return String(req.headers?.['x-oshal-user-sub'] || '').trim() || null;
  },
  getCaller(req) { return { sub: req.oidc?.user?.sub || null, email: req.oidc?.user?.email || null }; },
  isOperatorIdentity() { return false; },
};

let lastRouter = null;
const origLoad = Module._load;
Module._load = function shimmedLoad(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (request === '@/shared/services/database') return { buildOwnerRlsPolicyStatements: () => [] };
  if (request === '@/shared/middleware/authz') return authzShim;
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null };
  if (request === '@/app/routes/inline-bot-execution') return { executeBotOrInline: async () => ({ response: '{}' }) };
  if (request === 'express') {
    return {
      Router: () => {
        const handlers = new Map();
        const rec = (m) => (p, ...fns) => { handlers.set(`${m} ${p}`, fns[fns.length - 1]); };
        lastRouter = { get: rec('GET'), post: rec('POST'), put: rec('PUT'), patch: rec('PATCH'), delete: rec('DELETE'), use: () => {}, __handlers: handlers };
        return lastRouter;
      },
    };
  }
  if (request === './pumpkin-engine') return engineFacade;
  return origLoad.call(this, request, ...rest);
};

const registry = require(path.join(ROUTES_DIR, 'pumpkin-engine-room-registry.js'));
const reply = require(path.join(ROUTES_DIR, 'pumpkin-engine-reply.js'));
const engineFacade = {
  ...registry,
  parsePumpkinReply: reply.parsePumpkinReply,
  PumpkinPresetService: StubPresetService,
  PumpkinResponseService: StubResponseService,
};
const { createPumpkinRoutes } = require(path.join(ROUTES_DIR, 'pumpkin-routes.js'));
createPumpkinRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: PKG });
const HANDLERS = lastRouter.__handlers;

function makeRes() {
  const res = {
    statusCode: null, body: undefined, headersSent: false,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; res.headersSent = true; return res; },
    send(b) { res.body = b; res.headersSent = true; return res; },
  };
  return res;
}

async function call(route, opts = {}) {
  const handler = HANDLERS.get(route);
  assert.ok(handler, `missing route ${route}`);
  const req = { headers: opts.headers || {}, body: opts.body || {}, query: opts.query || {}, params: opts.params || {}, path: '/', oidc: opts.oidc, on() {} };
  const res = makeRes();
  await handler(req, res);
  return res;
}

let seq = 0;
function makeLiveRoom(label = 'Front Porch', ownerSub = null) {
  const sub = ownerSub || `stop-owner-${++seq}`;
  const { room, token } = registry.pumpkinRooms.register(sub, label);
  const events = [];
  const unsub = registry.pumpkinRooms.subscribe(sub, room, (evt) => { events.push(evt); });
  return { sub, room, token, events, unsub };
}

test.beforeEach(() => {
  delete process.env.MOCK_OIDC;
  delete process.env.PUMPKIN_ALLOWED_SUBS;
  delete process.env.PUMPKIN_ALLOWED_EMAILS;
  delete process.env.PUMPKIN_ALLOW_SWARM_SPEAK;
  process.env.SWARM_SERVICE_SECRET = SERVICE_SECRET;
});

test.after(() => {
  registry.pumpkinRooms.stop();
  Module._load = origLoad;
});

test('POST /rooms/stop delivers stop to SSE and polling screens and refuses bad tokens or foreign owners', async () => {
  const r = makeLiveRoom('Front Porch');
  const firstPoll = await call('GET /rooms/poll', {
    query: { room: r.room, client: 'proj-1' },
    oidc: { isAuthenticated: () => true, user: { sub: r.sub } },
  });
  assert.equal(firstPoll.body.ok, true);

  const badTok = await call('POST /rooms/stop', {
    body: { room: r.room, token: 'wrong-token' },
    oidc: { isAuthenticated: () => true, user: { sub: r.sub } },
  });
  assert.equal(badTok.statusCode, 403);
  assert.equal(badTok.body.error, 'invalid_room_or_token');
  assert.deepEqual(r.events, []);

  const foreign = await call('POST /rooms/stop', {
    body: { room: r.room, token: r.token },
    oidc: { isAuthenticated: () => true, user: { sub: 'intruder-sub' } },
  });
  assert.equal(foreign.statusCode, 403);
  assert.deepEqual(r.events, []);

  const ok = await call('POST /rooms/stop', {
    body: { room: r.room, token: r.token },
    oidc: { isAuthenticated: () => true, user: { sub: r.sub } },
  });
  assert.equal(ok.statusCode, null);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.listeners, 2);
  assert.deepEqual(r.events, [{ type: 'stop' }]);

  const nextPoll = await call('GET /rooms/poll', {
    query: { room: r.room, client: 'proj-1', after: String(firstPoll.body.cursor) },
    oidc: { isAuthenticated: () => true, user: { sub: r.sub } },
  });
  assert.deepEqual(nextPoll.body.events, [{ type: 'stop' }]);
  r.unsub();
});

test('POST /stop delivers stop for concierge OIDC or service secret, and refuses MOCK_OIDC, forged secrets, and dark rooms', async () => {
  const darkSub = `stop-owner-${++seq}`;
  const noRoom = await call('POST /stop', {
    headers: { 'x-service-secret': SERVICE_SECRET, 'x-oshal-user-sub': darkSub },
  });
  assert.equal(noRoom.statusCode, 409);
  assert.equal(noRoom.body.error, 'no_live_pumpkin');

  registry.pumpkinRooms.register(darkSub, 'Porch');
  const unattached = await call('POST /stop', {
    oidc: { isAuthenticated: () => true, user: { sub: darkSub } },
  });
  assert.equal(unattached.statusCode, 409);
  assert.equal(unattached.body.error, 'projector_not_listening');

  const r = makeLiveRoom('Porch');
  process.env.MOCK_OIDC = 'true';
  const mockAttempt = await call('POST /stop', {});
  assert.equal(mockAttempt.statusCode, 403);
  assert.equal(mockAttempt.body.error, 'service_secret_required');
  delete process.env.MOCK_OIDC;

  const forged = await call('POST /stop', {
    headers: { 'x-service-secret': 'forged', 'x-oshal-user-sub': r.sub },
    oidc: { isAuthenticated: () => true, user: { sub: r.sub } },
  });
  assert.equal(forged.statusCode, 403);
  assert.deepEqual(r.events, []);

  const viaOidc = await call('POST /stop', {
    oidc: { isAuthenticated: () => true, user: { sub: r.sub } },
  });
  assert.equal(viaOidc.body.ok, true);
  assert.equal(viaOidc.body.listeners, 1);

  const viaSvc = await call('POST /stop', {
    headers: { 'x-service-secret': SERVICE_SECRET, 'x-oshal-user-sub': r.sub },
  });
  assert.equal(viaSvc.body.ok, true);
  assert.deepEqual(r.events, [{ type: 'stop' }, { type: 'stop' }]);
  r.unsub();
});

function createBrowserSandbox() {
  let aborted = false;
  let browserSpoke = 0;
  class FakeAbortController {
    constructor() { this.signal = { aborted: false }; }
    abort() { aborted = true; this.signal.aborted = true; if (this._onAbort) this._onAbort(); }
  }
  const win = {
    devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
    addEventListener() {}, requestAnimationFrame() {},
    AbortController: FakeAbortController,
    AudioContext: class { constructor() { this.state = 'running'; this.destination = {}; } resume() { return Promise.resolve(); } },
    SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
    speechSynthesis: { speak() { browserSpoke += 1; }, cancel() {}, getVoices: () => [] },
  };
  win.window = win;
  const fetchFn = (_url, opts) => new Promise((_res, rej) => {
    if (opts && opts.signal) {
      win.AbortController.prototype._onAbort = () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    }
  });
  const ctx = vm.createContext({ window: win, document: {}, navigator: {}, fetch: fetchFn, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync(path.join(PKG, 'tools', 'pumpkin-face.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(PKG, 'tools', 'pumpkin-audio.js'), 'utf8'), ctx);
  return { win, getAborted: () => aborted, getBrowserSpoke: () => browserSpoke };
}

test('PumpkinFace.stop() snaps jaw to zero immediately and PumpkinAudio.forceStop() aborts mid-synthesis without TTS fallback', async () => {
  const { win, getAborted, getBrowserSpoke } = createBrowserSandbox();
  const stubCtx = {
    setTransform() {}, fillRect() {}, save() {}, translate() {}, rotate() {}, scale() {}, restore() {},
    createRadialGradient: () => ({ addColorStop() {} }), beginPath() {}, ellipse() {}, fill() {}, moveTo() {}, lineTo() {}, closePath() {}, quadraticCurveTo() {},
  };
  const canvas = { getContext: () => stubCtx, style: {} };
  const preset = {
    colors: { background: '#000', bodyGlow: 'transparent', feature: '#ffb020', featureHot: '#fff', ambient: 'rgba(0,0,0,0.9)' },
    face: { eyeShape: 'triangle', mouthShape: 'jagged', toothCount: 4, eyeSpacing: 0.5, eyeSize: 0.5, mouthWidth: 0.7, browAngle: 0 },
    motion: { idleBob: 8, bobSpeed: 0.3, sway: 1, blinkPerMin: 9, gaze: 0.3, mouthReactivity: 1.1, flicker: 0.3 },
    glow: { blur: 30, intensity: 1 }, voice: { voiceId: 'Charon', rate: 1 },
  };
  const face = new win.PumpkinFace(canvas, preset);
  face.setExpression('laugh', 1);
  face.setSpeaking(true);
  face.setLevel(0.95);
  face.render(0.05);
  assert.ok(face.mouth > 0.3, 'mouth opened during speech');
  face.stop();
  assert.equal(face.speaking, false);
  assert.equal(face.mouth, 0);
  assert.equal(face.mouthTarget, 0);

  const audio = new win.PumpkinAudio('');
  let ended = 0;
  const speakPromise = audio.speak('Long sentence in progress', { voiceId: 'Charon' }, { onEnd: () => { ended += 1; } });
  await new Promise((r) => setImmediate(r));
  audio.forceStop();
  assert.equal(ended, 1, 'forceStop settles onEnd synchronously');
  assert.equal(getAborted(), true, 'in-flight synthesis fetch was aborted');
  await speakPromise;
  assert.equal(getBrowserSpoke(), 0, 'aborted synthesis must never fall through to speechSynthesis');
  assert.equal(ended, 1, 'onEnd fires once');
});

test('remote surface and manifest ship live Stop control and pumpkin-stop tool', () => {
  const remote = fs.readFileSync(path.join(PKG, 'tools', 'pumpkin-remote.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const persona = fs.readFileSync(path.join(PKG, 'personas', 'pumpkin-bot.yaml'), 'utf8');
  assert.match(remote, /id="stopBtn"/);
  assert.match(remote, /\/api\/pumpkin\/rooms\/stop/);
  assert.doesNotMatch(remote, /data-ds-backlog|data-ds-not-yet/);
  assert.match(manifest, /name: pumpkin-stop/);
  assert.match(manifest, /POST \/api\/pumpkin\/stop/);
  assert.match(persona, /pumpkin-stop:\s*auto/);
});
