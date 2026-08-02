/**
 * DEVICE LINKS, QR, AND THE SHORT PROJECTOR URL.
 *
 * Three things the prop's night depends on, all of which were broken in a way no compiler and no
 * existing suite could see:
 *
 *   1. GET /links + GET /qr were documented across a whole README section and both QR runbook steps
 *      but were never registered, so the control surface's Projector-link card and BOTH QR images
 *      sat permanently in their degraded fallback — a URL built from the cockpit browser's own
 *      address, i.e. http://localhost:35457 on the operator's laptop, which cannot open on a phone.
 *   2. PUT /settings silently DROPPED the roomLabel the surface sends on Launch, so the short-form
 *      projector URL the runbook has you type could not restore the room: the projector came up in
 *      'main' while the cockpit and the phone pushed into 'front-porch'.
 *   3. The QR encodes a URL. A QR generator that will encode a CALLER-SUPPLIED url, served from a
 *      signed-in page on the deployment's own domain, is a phishing tool — so the target set is
 *      closed and that is asserted here, not just intended.
 *
 * Everything runs against the COMPILED routes/*.js — the exact bytes the framework mounts — with
 * only the kernel @/ seams and the Postgres-backed stores replaced, and the stores are RECORDERS so
 * "what did the route actually persist?" is a direct assertion.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const ROUTES_DIR = path.resolve(__dirname, '..', 'routes');
const SERVICE_SECRET = 'test-swarm-service-secret-0123456789';

// ── Recording doubles ───────────────────────────────────────────────────────────────────────────
/** Records every saveSettings call and answers getSettings from what was stored. */
const settingsCalls = [];
let storedSettings = { activePreset: 'inflatable', mode: 'mimic', roomLabel: 'Main' };
class RecordingPresetService {
  async ensureSchema() {}
  async listPresets() { return [{ name: 'inflatable' }]; }
  async getPreset(_sub, name) { return { name: String(name) }; }
  async savePreset(_sub, name) { return { name }; }
  async deletePreset() { return true; }
  async getSettings() { return storedSettings; }
  async saveSettings(sub, activePreset, mode, roomLabel) {
    settingsCalls.push({ sub, activePreset, mode, roomLabel });
    storedSettings = {
      activePreset,
      mode,
      roomLabel: roomLabel === undefined ? storedSettings.roomLabel : String(roomLabel),
    };
  }
}
class NoopResponseService {
  async ensureSchema() {}
  async record() { return null; }
  async list() { return []; }
  async get() { return null; }
  async setPinned() { return null; }
  async remove() { return false; }
  async markPlayed() {}
}

/** The kernel authz seam, mirrored exactly (see pumpkin-swarm-push.test.cjs for why). */
const crypto = require('node:crypto');
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
function fakeRouterFactory() {
  const handlers = new Map();
  const record = (method) => (routePath, ...fns) => { handlers.set(`${method} ${routePath}`, fns[fns.length - 1]); };
  lastRouter = {
    get: record('GET'), post: record('POST'), put: record('PUT'),
    patch: record('PATCH'), delete: record('DELETE'), use: () => {},
    __handlers: handlers,
  };
  return lastRouter;
}

// The QR encoder is a CORE-image dependency, absent from this repo on purpose (these suites run with
// no install). The route requires it lazily, which is exactly why the module still loads here — and
// the "encoder unavailable" path below is therefore the real one, not a simulation.
const origLoad = Module._load;
Module._load = function shimmedLoad(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/shared/services/database') {
    return { buildOwnerRlsPolicyStatements: (t) => [`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`] };
  }
  if (request === '@/shared/middleware/authz') return authzShim;
  if (request === '@/features/agent-management') {
    return { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null };
  }
  if (request === '@/app/routes/inline-bot-execution') {
    return { executeBotOrInline: async () => ({ response: '{}' }) };
  }
  if (request === 'express') return { Router: fakeRouterFactory };
  if (request === './pumpkin-engine') return engineFacade;
  return origLoad.call(this, request, ...rest);
};

// The REAL link builder and room registry — they are what these guards are about.
const links = require(path.join(ROUTES_DIR, 'pumpkin-engine-links.js'));
const registry = require(path.join(ROUTES_DIR, 'pumpkin-engine-room-registry.js'));
const reply = require(path.join(ROUTES_DIR, 'pumpkin-engine-reply.js'));

const engineFacade = {
  ...registry,
  ...links,
  parsePumpkinReply: reply.parsePumpkinReply,
  PumpkinPresetService: RecordingPresetService,
  PumpkinResponseService: NoopResponseService,
};

const { createPumpkinRoutes } = require(path.join(ROUTES_DIR, 'pumpkin-routes.js'));
createPumpkinRoutes({ pool: { query: async () => ({ rows: [] }) }, appPackageDir: path.resolve(__dirname, '..') });
const HANDLERS = lastRouter.__handlers;

function makeRes() {
  const res = {
    statusCode: null, body: undefined, headersSent: false, contentType: null, headers: {},
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; res.headersSent = true; return res; },
    send(body) { res.body = body; res.headersSent = true; return res; },
    type(t) { res.contentType = t; return res; },
    set(k, v) { res.headers[k] = v; return res; },
    sendFile() {},
  };
  return res;
}

function makeReq(opts = {}) {
  return {
    headers: opts.headers || {},
    body: opts.body || {},
    query: opts.query || {},
    params: opts.params || {},
    path: opts.path || '/',
    hostname: opts.hostname || 'localhost',
    oidc: opts.oidc || undefined,
  };
}

const browserReq = (sub, opts = {}) => makeReq({
  ...opts,
  oidc: { isAuthenticated: () => true, user: { sub } },
});

async function call(route, req) {
  const handler = HANDLERS.get(route);
  assert.ok(handler, `route not registered: ${route} (registered: ${[...HANDLERS.keys()].join(', ')})`);
  const res = makeRes();
  await handler(req, res);
  return res;
}

test.beforeEach(() => {
  settingsCalls.length = 0;
  storedSettings = { activePreset: 'inflatable', mode: 'mimic', roomLabel: 'Main' };
  process.env.SWARM_SERVICE_SECRET = SERVICE_SECRET;
  delete process.env.PUMPKIN_PUBLIC_ORIGIN;
  delete process.env.APP_URL;
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTES EXIST AT ALL — the whole point of the finding
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('GET /links and GET /qr are REGISTERED — the surface has been calling them all along', () => {
  assert.ok(HANDLERS.has('GET /links'), 'the control surface Projector-link card depends on this');
  assert.ok(HANDLERS.has('GET /qr'), 'both <img> QR tags depend on this');
});

test('an unauthenticated caller gets nothing from either route', async () => {
  const l = await call('GET /links', makeReq({ query: { label: 'Front Porch' } }));
  assert.equal(l.statusCode, 401);
  const q = await call('GET /qr', makeReq({ query: { target: 'remote' } }));
  assert.equal(q.statusCode, 401);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE LINKS ARE BUILT FROM THE PUBLIC ORIGIN, NOT FROM THE BROWSER'S ADDRESS
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('absolute links come from APP_URL, never from the cockpit host', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  // The request host is the operator's laptop — the exact address the browser fallback produced,
  // and the reason this endpoint exists.
  const res = await call('GET /links', browserReq('owner-1', {
    hostname: 'localhost',
    query: { label: 'Front Porch', mode: 'mimic', preset: 'inflatable' },
  }));

  assert.equal(res.body.origin, 'https://oshal.agenticfederal.us');
  for (const url of [res.body.projectorUrl, res.body.projectorShortUrl, res.body.remoteUrl]) {
    assert.ok(url.startsWith('https://oshal.agenticfederal.us/'), `not absolute-public: ${url}`);
    assert.ok(!/localhost/.test(url), `a phone cannot open this: ${url}`);
  }
});

test('PUMPKIN_PUBLIC_ORIGIN wins over APP_URL, and a trailing slash never doubles up', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  process.env.PUMPKIN_PUBLIC_ORIGIN = 'https://porch.example.com/';
  const res = await call('GET /links', browserReq('owner-1', { query: { label: 'Front Porch' } }));
  assert.equal(res.body.origin, 'https://porch.example.com');
  assert.equal(res.body.projectorShortUrl, 'https://porch.example.com/pumpkin/');
});

test('the room in every link is the SERVER slug the push path will actually find', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  const label = 'Front Porch';
  const res = await call('GET /links', browserReq('owner-1', { query: { label } }));

  assert.equal(res.body.room, registry.roomSlug(label), 'one slug rule, derived once, server-side');
  assert.ok(res.body.projectorUrl.includes(`room=${res.body.room}`));
  assert.ok(res.body.remoteUrl.includes(`room=${res.body.room}`));
  // slug(slug(x)) === slug(x) is what stops a re-slugified link landing in a DIFFERENT room.
  assert.equal(registry.roomSlug(res.body.room), res.body.room);
});

test('the short form is exactly the origin plus /pumpkin/ — nothing to mistype', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  const res = await call('GET /links', browserReq('owner-1', {
    query: { label: 'Front Porch', mode: 'autonomous', preset: 'graveyard' },
  }));
  assert.equal(res.body.projectorShortUrl, 'https://oshal.agenticfederal.us/pumpkin/');
  assert.ok(!res.body.projectorShortUrl.includes('?'), 'a query string defeats the whole point');
});

test('the QR urls are RELATIVE — they render inside the cockpit iframe', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  const res = await call('GET /links', browserReq('owner-1', { query: { label: 'Front Porch' } }));
  assert.ok(res.body.projectorQrUrl.startsWith('/api/pumpkin/qr?'), res.body.projectorQrUrl);
  assert.ok(res.body.remoteQrUrl.startsWith('/api/pumpkin/qr?'), res.body.remoteQrUrl);
});

test('no pairing token, and nothing token-shaped, is ever in a /links response', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  const owner = 'owner-token-check';
  const { token } = registry.pumpkinRooms.register(owner, 'Front Porch');
  const res = await call('GET /links', browserReq(owner, { query: { label: 'Front Porch' } }));

  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes(token), 'the pairing token is what stops a screen being seized');
  assert.ok(!/token/i.test(serialized), 'not even a field named like one');
});

test('a hostile label cannot break out of the query string it lands in', async () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  const res = await call('GET /links', browserReq('owner-1', {
    query: { label: 'Porch&mode=autonomous&preset=../../etc', preset: 'a b' },
  }));
  assert.ok(!res.body.projectorUrl.includes('&mode=autonomous&preset=../../etc'));
  assert.equal(res.body.mode, 'mimic', 'a smuggled mode never becomes the real one');
  assert.equal(registry.roomSlug(res.body.label), res.body.room);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE QR TARGET SET IS CLOSED
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('an unknown QR target is refused rather than guessed', async () => {
  const res = await call('GET /qr', browserReq('owner-1', { query: { target: 'somewhere-else' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'unknown_qr_target');
});

test('a caller-supplied url is NOT a QR target — this endpoint cannot be aimed', async () => {
  // A signed-in QR generator that encodes attacker-chosen URLs on the deployment's own domain is a
  // phishing tool. `target` is the only field that chooses a destination.
  const res = await call('GET /qr', browserReq('owner-1', {
    query: { url: 'https://evil.example.com/steal', target: 'https://evil.example.com/steal' },
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'unknown_qr_target');
});

test('the two allowed targets encode EXACTLY the urls /links published', () => {
  process.env.APP_URL = 'https://oshal.agenticfederal.us';
  const request = { label: 'Front Porch', mode: 'mimic', preset: 'inflatable' };
  const built = links.buildPumpkinLinks('https://oshal.agenticfederal.us', request);
  // A drift here means the printed code and the copied link point at different rooms, and only the
  // phone finds out — at night, in a yard.
  assert.equal(links.pumpkinQrTargetUrl('https://oshal.agenticfederal.us', 'projector', request), built.projectorUrl);
  assert.equal(links.pumpkinQrTargetUrl('https://oshal.agenticfederal.us', 'remote', request), built.remoteUrl);
});

test('a valid target with no encoder available fails as qr_unavailable, never as a broken app', async () => {
  // `qrcode` is a core-image dependency and is genuinely absent here, so this exercises the real
  // lazy-require failure path. The surface hides the <img> and tells the operator to copy the link.
  const res = await call('GET /qr', browserReq('owner-1', { query: { target: 'remote', label: 'Front Porch' } }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'qr_unavailable');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHORT URL'S OTHER HALF: the room label is actually PERSISTED
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('PUT /settings passes roomLabel through — it used to be dropped on the floor', async () => {
  const res = await call('PUT /settings', browserReq('owner-1', {
    body: { activePreset: 'graveyard', mode: 'autonomous', roomLabel: 'Front Porch' },
  }));
  assert.equal(res.body.ok, true);
  assert.deepEqual(settingsCalls, [{
    sub: 'owner-1', activePreset: 'graveyard', mode: 'autonomous', roomLabel: 'Front Porch',
  }]);
});

test('an omitted roomLabel is passed as undefined, so a live room is never blanked', async () => {
  await call('PUT /settings', browserReq('owner-1', {
    body: { activePreset: 'graveyard', mode: 'mimic', roomLabel: 'Front Porch' },
  }));
  await call('PUT /settings', browserReq('owner-1', { body: { activePreset: 'classic', mode: 'mimic' } }));

  assert.equal(settingsCalls[1].roomLabel, undefined, 'not "" — the store must be able to tell them apart');
  const read = await call('GET /settings', browserReq('owner-1'));
  assert.equal(read.body.roomLabel, 'Front Porch', 'the previously saved room survived');
});

test('GET /settings returns the room label the projector needs to restore', async () => {
  await call('PUT /settings', browserReq('owner-1', {
    body: { activePreset: 'graveyard', mode: 'autonomous', roomLabel: 'Back Gate' },
  }));
  const read = await call('GET /settings', browserReq('owner-1'));
  assert.deepEqual(read.body, { activePreset: 'graveyard', mode: 'autonomous', roomLabel: 'Back Gate' });
});

test('a non-string roomLabel is ignored rather than stringified into a junk room', async () => {
  await call('PUT /settings', browserReq('owner-1', {
    body: { activePreset: 'classic', mode: 'mimic', roomLabel: { evil: true } },
  }));
  assert.equal(settingsCalls[0].roomLabel, undefined);
});
