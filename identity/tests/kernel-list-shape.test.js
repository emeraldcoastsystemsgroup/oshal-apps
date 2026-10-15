/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the shipped Identity Hub script over the native kernel's /api/connect/list shape: connector kinds
 *   oauth / personal_token / api_key map to the redirect flow or the /utilities setup, a lapsed native grant (status expired or
 *   revoked, no per-account rows) reads as Reconnect and needs attention, and Connect/Reconnect start consent at
 *   /api/connect/{id}/start with a fallback to the kernel's JSON /connectors/{id}/authorize answer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A kernel refusal ({detail, refused}) is shown in its own words ("This installation has no public web
 *   address yet, ...") instead of "HTTP 400".
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The kernel now sends per-account rows: a lapsed grant WITH its account row still reads Reconnect and
 *   needs attention, and a renewable (renewed-by-the-kernel) grant reads Connected.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'identity.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((b) => /async function load\(\)/.test(b));

function stubElement() {
  return {
    innerHTML: '', value: '', textContent: '', disabled: false, onclick: null,
    classList: { toggle() {}, add() {}, remove() {} },
    querySelectorAll: () => [], addEventListener() {}, getAttribute: () => null,
  };
}

/**
 * Run the surface script in a vm with a stub DOM, a scripted fetch and a recording window.open.
 * @param providers - the /api/connect/list payload.
 * @param routes - extra fetch answers keyed by URL prefix: a function (init) => response-like.
 */
async function surface(providers, routes = {}) {
  const nodes = new Map();
  const requested = [];
  const tabs = [];
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, stubElement()); return nodes.get(id); } };
  const fetchStub = async (url, init) => {
    requested.push({ url, init });
    if (url.startsWith('/api/connect/list')) return { ok: true, status: 200, json: async () => ({ providers, available: true }) };
    if (url.startsWith('/api/connect/liveness')) return { ok: false, status: 404, json: async () => ({}) };
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (route) return routes[route](init);
    return { ok: false, status: 404, type: 'basic', json: async () => { throw new Error('not json'); } };
  };
  const window = { open(url, target) { const tab = { url, target, opener: 'parent', closed: false, location: { href: '' }, close() { this.closed = true; } }; tabs.push(tab); return tab; } };
  const sandbox = { document, window, fetch: fetchStub, console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${script}\n;globalThis.__surface = { load, startConsent };`, sandbox, { filename: 'identity.html' });
  await sandbox.__surface.load();
  return { nodes, requested, tabs, surface: sandbox.__surface };
}

/** One card's HTML by its display label. */
function card(main, label) {
  const found = main.split('<div class="card">').find((chunk) => chunk.includes(`<span class="name">${label}</span>`));
  assert.ok(found, `card ${label} rendered`);
  return found;
}

/** The native kernel's list row: no per-account rows, a liveness status, kernel connector kinds. */
function native(id, auth, status, extra = {}) {
  return { id, label: id, auth, configured: true, connected: status === 'connected' || status === 'expiring', status, connections: [], accountDetailsAvailable: false, multiAccount: false, defaultConnectionId: null, source: 'native-connector-liveness', ...extra };
}

test('native connector kinds and liveness render the right actions and attention counts', async () => {
  const { nodes } = await surface([
    native('google', 'oauth', 'connected', { category: 'email' }),
    native('github', 'personal_token', 'not_connected'),
    native('tmdb', 'api_key', 'connected'),
    native('outlook', 'oauth', 'expired', { category: 'email' }),
    native('linkedin', 'oauth', 'revoked'),
    native('slack', 'oauth', 'not_connected', { configured: false }),
    native('dropbox', 'oauth', 'expiring'),
  ]);
  const main = nodes.get('main').innerHTML;
  assert.match(card(main, 'google'), /data-start="google">Reconnect</);
  assert.match(card(main, 'google'), /pill ok">Connected/);
  assert.match(card(main, 'github'), /data-util="1">Set up</, 'a personal token is set up on /utilities, not a redirect flow');
  assert.doesNotMatch(card(main, 'github'), /data-start|Not configured/);
  assert.match(card(main, 'github'), /personal token/);
  assert.match(card(main, 'tmdb'), /data-util="1">Manage</, 'a connected API key is managed on /utilities');
  assert.match(card(main, 'tmdb'), /API key/);
  for (const lapsed of ['outlook', 'linkedin']) {
    assert.match(card(main, lapsed), /pill exp">Reconnect/);
    assert.match(card(main, lapsed), /data-start="[a-z]+">Reconnect</);
    assert.match(card(main, lapsed), /Saved sign-in has lapsed/);
  }
  assert.match(card(main, 'slack'), /Not configured/);
  assert.match(card(main, 'dropbox'), /pill soon">Expiring/);
  const metrics = nodes.get('identityMetrics').innerHTML;
  assert.match(metrics, /Need attention<\/span><strong>2</);
  assert.match(metrics, /Ready to enable<\/span><strong>6</);
});

test('consent follows the start route when it redirects, without asking the kernel route', async () => {
  const { surface: s, tabs, requested } = await surface([native('google', 'oauth', 'not_connected')], {
    '/api/connect/google/start': (init) => { assert.equal(init.redirect, 'manual'); return { type: 'opaqueredirect', status: 0, ok: false, json: async () => ({}) }; },
  });
  await s.startConsent('google');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].opener, null, 'the consent tab cannot reach back into the hub');
  assert.equal(tabs[0].location.href, '/api/connect/google/start');
  assert.ok(!requested.some((r) => r.url.startsWith('/connectors/')));
});

test('consent falls back to the kernel JSON authorize answer, authorize_url or url', async () => {
  for (const body of [{ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=a' }, { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=b' }]) {
    const { surface: s, tabs } = await surface([native('google-calendar', 'oauth', 'not_connected')], {
      '/connectors/google-calendar/authorize': () => ({ ok: true, status: 200, json: async () => body }),
    });
    await s.startConsent('google-calendar');
    assert.equal(tabs[0].location.href, body.authorize_url || body.url);
    assert.equal(tabs[0].closed, false);
  }
  // A start route that answers JSON naming the provider is followed too.
  const { surface: s, tabs } = await surface([native('gmail', 'oauth', 'not_connected')], {
    '/api/connect/gmail/start': () => ({ type: 'basic', ok: true, status: 200, json: async () => ({ url: 'https://accounts.google.com/x' }) }),
  });
  await s.startConsent('gmail');
  assert.equal(tabs[0].location.href, 'https://accounts.google.com/x');
});

test('consent that no route can start closes the tab and says why; a non-https answer is never followed', async () => {
  const { surface: s, tabs, nodes } = await surface([native('google', 'oauth', 'not_connected')], {
    '/connectors/google/authorize': () => ({ ok: false, status: 409, json: async () => ({ error: 'google is not configured' }) }),
  });
  await s.startConsent('google');
  assert.equal(tabs[0].closed, true);
  assert.equal(tabs[0].location.href, '');
  assert.match(nodes.get('review').innerHTML, /Could not start the connection: google is not configured/);
  const hostile = await surface([native('google', 'oauth', 'not_connected')], {
    '/connectors/google/authorize': () => ({ ok: true, status: 200, json: async () => ({ url: 'javascript:alert(1)' }) }),
  });
  await hostile.surface.startConsent('google');
  assert.equal(hostile.tabs[0].closed, true);
  assert.equal(hostile.tabs[0].location.href, '');
});

test('a kernel refusal is shown in its own words, never a bare status', async () => {
  const words = 'This installation has no public web address yet, so Google cannot be connected here.';
  const refused = () => ({ ok: false, status: 400, json: async () => ({ detail: words, refused: 'invalid_request' }) });
  const { surface: s, tabs, nodes } = await surface([native('google', 'oauth', 'not_connected')], {
    '/api/connect/google/start': refused, '/connectors/google/authorize': refused,
  });
  await s.startConsent('google');
  assert.equal(tabs[0].closed, true);
  assert.match(nodes.get('review').innerHTML, new RegExp(`Could not start the connection: ${words.replace(/\./g, '\\.')}`));
  assert.doesNotMatch(nodes.get('review').innerHTML, /HTTP 400|invalid_request/);
});

test('a lapsed native grant listed with its account row reads Reconnect, as Settings reads it', async () => {
  const row = (connector, status) => ({ connector, account: 'primary', label: 'primary', liveness: status, status, renewable: false, expired: true, expiring: false });
  const { nodes } = await surface([
    native('schwab', 'oauth', 'expired', { label: 'Charles Schwab', category: 'Finance', connections: [row('schwab', 'expired')] }),
    native('gcp', 'oauth', 'revoked', { label: 'Google Cloud', connections: [row('gcp', 'revoked')] }),
    native('google', 'oauth', 'connected', { label: 'Google', connections: [{ ...row('google', 'connected'), expired: false }] }),
  ]);
  const main = nodes.get('main').innerHTML;
  for (const label of ['Charles Schwab', 'Google Cloud']) {
    assert.match(card(main, label), /pill exp">Reconnect/, `${label} is not shown connected`);
    assert.match(card(main, label), /data-start="[a-z]+">Reconnect</);
  }
  assert.match(card(main, 'Google'), /pill ok">Connected/);
  assert.match(nodes.get('identityMetrics').innerHTML, /Need attention<\/span><strong>2</);
});
