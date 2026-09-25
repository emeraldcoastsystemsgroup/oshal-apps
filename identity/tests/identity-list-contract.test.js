/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-24 17:35:00 | maintainer@emeraldcoastsystemsgroup.com   | Add 'expiring' to CONNECTION_KEYS and assert that an expiring unrenewable connection renders the Expiring pill and · expiring marker while leaving healthy connections unaffected.
 * 2026-09-16 00:00:00 | maintainer@emeraldcoastsystemsgroup.com   | Run the shipped surface instead of counting `c.expired` matches in it. Four regex hits could never show that the marker, the pill, the tile and the filter actually RENDER, and they could not see the case the hub missed entirely: a grant the provider has revoked keeps its refresh token, so `expired` is false for it forever and the one screen built to show a broken login showed nothing. The surface script now runs in a vm over a stub DOM and a stub fetch, and the assertions read what it produced.
 * 2026-08-12 20:40:00 | maintainer@emeraldcoastsystemsgroup.com   | Initial BUG-13 guard, consuming half: every per-connection key the Identity Hub surface reads off /api/connect/list is in the response contract core promises, and the access-review inventory derives `expired` from core's shared isConnectionExpired rather than re-deriving `expiry < now`.
 *
 * The producing half lives in core (tests/unit/connector-list-expiry.spec.ts), which asserts the
 * response carries exactly these keys. Neither repo can import the other's tests, so the contract
 * is written down in both places and CONNECTION_KEYS below must be kept identical to core's list.
 *
 * Why this guard exists: the surface read `c.expired` in four places and the response never
 * carried the key. Reading a missing key is not an error in JavaScript — it is `undefined`, which
 * is falsy — so "Need attention" rendered a confident 0, the red Reconnect pill never appeared,
 * and the one screen built to show a stale login showed nothing. A missing key must fail here.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SURFACE = path.resolve(__dirname, '..', 'tools', 'identity.html');
const ROUTES_TS = path.resolve(__dirname, '..', 'src-routes', 'identity-routes.ts');
const ROUTES_JS = path.resolve(__dirname, '..', 'routes', 'identity-routes.js');

/** The per-connection keys /api/connect/list promises. Mirror of core's CONNECTION_KEYS. */
const CONNECTION_KEYS = ['connectionId', 'label', 'account', 'tenantId', 'isDefault', 'expired', 'expiring'];

const html = fs.readFileSync(SURFACE, 'utf8');

// ---------------------------------------------------------------------------
// Running the shipped surface. The page is one self-contained file, so this
// guard executes ITS script - not a copy of its logic - against a stub DOM and
// a stub fetch, then reads the HTML it produced. A regex count over the file
// can prove a key is mentioned; only this can prove the marker renders.
// ---------------------------------------------------------------------------

/** The surface's main script block (the one that owns load()). */
function surfaceScript() {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const source = blocks.find((b) => /async function load\(\)/.test(b));
  assert.ok(source, 'could not find the surface script - the scrape broke, not the surface');
  return source;
}

/** One stub element: enough surface area for the page's DOM writes and its wiring. */
function stubElement() {
  return {
    innerHTML: '', value: '', textContent: '', disabled: false, onclick: null,
    classList: { toggle() {}, add() {}, remove() {} },
    querySelectorAll: () => [],
    addEventListener() {},
    getAttribute: () => null,
  };
}

/**
 * Run the surface against one fixture and hand back what it rendered.
 * @param providers - the /api/connect/list payload.
 * @param liveness - the /api/connect/liveness payload, or null to fail that probe.
 */
async function renderSurface({ providers, liveness }) {
  const nodes = new Map();
  const requested = [];
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, stubElement());
      return nodes.get(id);
    },
  };
  const fetchStub = async (url) => {
    requested.push(url);
    if (url.startsWith('/api/connect/list')) return { ok: true, status: 200, json: async () => ({ providers }) };
    if (url.startsWith('/api/connect/liveness')) {
      if (!liveness) return { ok: false, status: 500, json: async () => ({ error: 'probe down' }) };
      return { ok: true, status: 200, json: async () => ({ providers: liveness }) };
    }
    throw new Error('the surface fetched an endpoint this guard does not stub: ' + url);
  };
  const sandbox = {
    document,
    window: { open() {} },
    fetch: fetchStub,
    console: { warn() {}, error() {}, log() {} },
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // The epilogue only hands already-defined internals out of the vm's script scope; it adds no
  // behaviour. load() runs once from the script's own last line and once here - rendering is
  // idempotent, and awaiting the second call is what makes this deterministic.
  vm.runInContext(
    surfaceScript()
    + '\n;globalThis.__surface = { load, countExpired, providerMatches,'
    + ' setFilter: (f) => { activeFilter = f; }, providers: () => allProviders };',
    sandbox,
    { filename: 'identity.html' },
  );
  await sandbox.__surface.load();
  return {
    main: nodes.get('main').innerHTML,
    metrics: nodes.get('identityMetrics').innerHTML,
    requested,
    surface: sandbox.__surface,
  };
}

/** One provider card's worth of /api/connect/list, with one account. */
function providerFixture(overrides = {}, connection = {}) {
  return {
    id: 'google',
    label: 'Google',
    category: 'email',
    auth: 'oauth',
    configured: true,
    tokenHelpUrl: null,
    tokenFallback: false,
    platformDefault: false,
    connected: true,
    multiAccount: false,
    defaultConnectionId: 'connection-1',
    status: 'connected',
    connections: [{
      connectionId: 'connection-1',
      label: 'work',
      account: 'work@example.com',
      tenantId: null,
      isDefault: true,
      expired: false,
      ...connection,
    }],
    ...overrides,
  };
}

/** The "Need attention" tile's rendered value. */
function needAttentionCount(metricsHtml) {
  const m = metricsHtml.match(/Need attention<\/span><strong>(\d+)<\/strong>/);
  assert.ok(m, 'the metrics strip did not render a "Need attention" tile: ' + metricsHtml);
  return Number(m[1]);
}

test('the surface reads only per-connection keys the list response promises', () => {
  // The surface names its connection objects `c` inside `(p.connections || []).some((c) => …)`
  // and the account-row map. Collect every property read off one and hold it to the contract.
  const reads = new Set();
  for (const m of html.matchAll(/\bc\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);
  assert.ok(reads.size > 0, 'found no c.<key> reads — the scrape broke, not the surface');

  const unknown = [...reads].filter((k) => !CONNECTION_KEYS.includes(k));
  assert.deepEqual(
    unknown, [],
    `the surface reads ${unknown.join(', ')} off a connection, which /api/connect/list does not `
    + 'promise. Either add it to the response contract (both repos) or stop reading it — an '
    + 'unpromised key renders as undefined and silently reads as "nothing to report".',
  );
});

test('a lapsed, unrenewable login renders the marker, the pill, the tile and the filter', async () => {
  const dead = providerFixture({}, { expired: true });
  const r = await renderSurface({ providers: [dead], liveness: [{ provider: 'google', status: 'ok' }] });

  assert.match(r.main, /· expired/, 'the account row shows no expired marker');
  assert.match(r.main, /pill exp">Reconnect/, 'the card shows no red Reconnect pill');
  assert.equal(needAttentionCount(r.metrics), 1);
  r.surface.setFilter('needs-attention');
  assert.equal(r.surface.providerMatches(dead), true, 'the needs-attention filter hides it');
});

test('an unrenewable connection within the warning window renders the Expiring pill and marker', async () => {
  const soon = providerFixture({}, { expired: false, expiring: true });
  const r = await renderSurface({ providers: [soon], liveness: [{ provider: 'google', status: 'ok' }] });

  assert.match(r.main, /· expiring/, 'the account row shows no expiring marker');
  assert.match(r.main, /pill soon">Expiring/, 'the card shows no Expiring pill');
  assert.doesNotMatch(r.main, /pill exp">Reconnect/);
  assert.doesNotMatch(r.main, /· expired/);
  // Expiring is distinct from expired: it is not yet dead, so needAttentionCount remains 0
  assert.equal(needAttentionCount(r.metrics), 0);
});

test('a grant the provider has REVOKED reaches the same four places', async () => {
  // The case `expired` cannot see. isConnectionExpired means "lapsed AND nothing left to renew
  // it", so a revoked grant - whose refresh token is still stored, and still dead - is false
  // there forever. On the G-Squared box exactly this shape (a Testing-mode Google grant that
  // answers `refresh 400`) sat green while invitations silently failed to send. Only a real
  // refresh against the provider settles it, so the hub has to ask.
  const revoked = providerFixture({}, { expired: false });
  const r = await renderSurface({
    providers: [revoked],
    liveness: [{ provider: 'google', status: 'needs_reconnect', detail: 'the provider rejected the stored grant' }],
  });

  assert.ok(
    r.requested.some((u) => u.startsWith('/api/connect/liveness')),
    'the hub never asked whether the provider still honors the grant, so a revoked login cannot '
    + 'be told apart from a healthy one',
  );
  assert.match(r.main, /· expired/, 'a revoked grant renders no expired marker');
  assert.match(r.main, /pill exp">Reconnect/, 'a revoked grant shows no red Reconnect pill');
  assert.equal(needAttentionCount(r.metrics), 1);
  r.surface.setFilter('needs-attention');
  assert.equal(r.surface.providerMatches(revoked), true, 'the needs-attention filter hides a revoked grant');
});

test('a healthy self-renewing login is left alone - the loud-direction regression', async () => {
  // BUG-13's other half: 9 of 24 live connections were past their access-token expiry and every
  // one of them was refreshable and healthy. Flagging those is the failure this package already
  // shipped once; a liveness `ok` must not reintroduce it.
  const healthy = providerFixture();
  const r = await renderSurface({ providers: [healthy], liveness: [{ provider: 'google', status: 'ok' }] });

  assert.doesNotMatch(r.main, /· expired/);
  assert.match(r.main, /pill ok">Connected/);
  assert.equal(needAttentionCount(r.metrics), 0);
  r.surface.setFilter('needs-attention');
  assert.equal(r.surface.providerMatches(healthy), false);
});

test('a probe that cannot answer never repaints a working account red', async () => {
  // The probe only ever ADDS honesty. A 500, a timeout or an `unknown` verdict must leave the
  // row-derived flags exactly as they were, and must not blank a page that already rendered.
  const healthy = providerFixture();
  const down = await renderSurface({ providers: [healthy], liveness: null });
  assert.doesNotMatch(down.main, /· expired/);
  assert.equal(needAttentionCount(down.metrics), 0);
  assert.match(down.main, /Google/, 'the probe failure blanked the grid');

  const unsure = await renderSurface({
    providers: [healthy],
    liveness: [{ provider: 'google', status: 'unknown', detail: 'network' }],
  });
  assert.doesNotMatch(unsure.main, /· expired/);
  assert.equal(needAttentionCount(unsure.metrics), 0);
});

for (const [name, file] of [['source', ROUTES_TS], ['compiled', ROUTES_JS]]) {
  test(`the ${name} access-review inventory uses core's shared expiry rule`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(
      /isConnectionExpired/.test(src),
      'the inventory must derive expired from core isConnectionExpired, so the advisor bot and '
      + 'the hub cannot disagree about which logins are broken',
    );
    assert.ok(
      /isConnectionExpiring/.test(src),
      'the inventory must derive expiring from core isConnectionExpiring, so the advisor bot and '
      + 'the hub warn about unrenewable connections before they lapse',
    );
    // The naive rule is the specific regression: it reports every refreshable connection whose
    // short-lived access token has lapsed (most healthy OAuth connections, most of the time).
    assert.ok(
      !/expiry\)\.getTime\(\)\s*<\s*now/.test(src),
      'found the naive `expiry < now` rule — that flags healthy self-renewing connections',
    );
    assert.ok(
      /refreshable/.test(src),
      'the inventory must tell the advisor whether an authorization can renew itself, or the bot '
      + 'will read a past expiry as a broken login',
    );
  });
}

const MANIFEST = path.resolve(__dirname, '..', 'oshal-app.yaml');
const BRIEFINGS_TS = path.resolve(__dirname, '..', 'src-routes', 'expiring-connection-briefings.ts');
const BRIEFINGS_JS = path.resolve(__dirname, '..', 'routes', 'expiring-connection-briefings.js');

test('the identity manifest registers the expiring-connection briefing', () => {
  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  assert.ok(/uses:.*jarvis-briefings/.test(yaml), 'manifest must include jarvis-briefings in uses');
  assert.ok(/id:\s*expiring-connections/.test(yaml), 'manifest must declare expiring-connections briefing');
  assert.ok(/sessionId:\s*identity-expiring-connections/.test(yaml), 'manifest must declare identity-expiring-connections sessionId');
  assert.ok(/routes\/expiring-connection-briefings\.js/.test(yaml), 'manifest must mount expiring-connection-briefings route');
});

for (const [name, file] of [['source', BRIEFINGS_TS], ['compiled', BRIEFINGS_JS]]) {
  test(`the ${name} expiring-connection briefing collector complies with kernel briefing contract`, () => {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(/isConnectionExpiring/.test(src), 'briefing collector must filter using isConnectionExpiring');
    assert.ok(/saveCompletedBriefing/.test(src), 'briefing collector must deliver via taskStore.saveCompletedBriefing');
    assert.ok(/identity-expiring-connections/.test(src), 'briefing collector must target identity-expiring-connections session');
    assert.ok(/daysLeft/.test(src), 'briefing collector must state days remaining');
  });
}

