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
 * 4 | maintainer@emeraldcoastsystemsgroup.com | UX audit split: the count reads 'Needs attention' and 'Available', and a connector with no configured sign-in
 *   is hidden from the catalog until 'Show unavailable' is on.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.2.8 (Roger, 2026-11-15: "...does not have permission to navigate the target frame"): the
 *   consent cases follow the new start. Connect/Reconnect open the kernel's /api/connect/{id}/start in the click, with no
 *   request first, returning to the kernel's connect window; a web view that hands back its top window is never steered
 *   afterwards; with no second window the page itself goes, returning where the person was; the connect window's answer
 *   is said in the kernel's words and reloads the list; a return path keeps only the kernel's safe_return shape. The
 *   JSON /connectors/{id}/authorize fallback cases are gone with the fallback.
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
 * Run the surface script in a vm with a stub DOM, a scripted fetch, a recording window.open and BroadcastChannel.
 * @param providers - the /api/connect/list payload (an array, or a function answering the current one).
 * @param routes - extra fetch answers keyed by URL prefix: a function (init) => response-like.
 * @param options - `open(url, target)` replaces the recording window.open; `framed` puts the page in the shell at
 *   /cockpit/?app=identity; `noChannel` leaves BroadcastChannel out.
 */
async function surface(providers, routes = {}, options = {}) {
  const nodes = new Map();
  const requested = [];
  const tabs = [];
  const channels = [];
  const listeners = {};
  const document = {
    visibilityState: 'visible',
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, stubElement()); return nodes.get(id); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const list = () => (typeof providers === 'function' ? providers() : providers);
  const fetchStub = async (url, init) => {
    requested.push({ url, init });
    if (url.startsWith('/api/connect/list')) return { ok: true, status: 200, json: async () => ({ providers: list(), available: true }) };
    if (url.startsWith('/api/connect/liveness')) return { ok: false, status: 404, json: async () => ({}) };
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (route) return routes[route](init);
    return { ok: false, status: 404, type: 'basic', json: async () => { throw new Error('not json'); } };
  };
  const own = { origin: 'https://swarm.example', pathname: '/api/identity/', search: '', href: '' };
  const window = {
    location: own,
    open: options.open || ((url, target) => { const tab = { url, target, opener: 'parent', closed: false, location: { href: '' }, close() { this.closed = true; } }; tabs.push(tab); return tab; }),
  };
  window.top = options.framed ? { location: { origin: own.origin, pathname: '/cockpit/', search: '?app=identity', href: '' } } : window;
  class Channel {
    constructor(name) { this.name = name; this.closed = false; this.onmessage = null; channels.push(this); }
    close() { this.closed = true; }
  }
  const sandbox = { document, window, fetch: fetchStub, console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout };
  if (!options.noChannel) sandbox.BroadcastChannel = Channel;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${script}\n;globalThis.__surface = { load, startConsent, returnPath, waiting: () => waiting, showAll: () => { showUnavailable = true; renderProviders(); } };`, sandbox, { filename: 'identity.html' });
  await sandbox.__surface.load();
  return { nodes, requested, tabs, channels, listeners, window, surface: sandbox.__surface };
}

/** Let the page's pending promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The address a Connect/Reconnect press opens: the kernel's start, returning to the kernel's connect window. */
const startInWindow = (id) => `/api/connect/${id}/start?return=${encodeURIComponent(`/utilities?connected=${id}&window=connect`)}`;

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
  const surfaceRun = await surface([
    native('google', 'oauth', 'connected', { category: 'email' }),
    native('github', 'personal_token', 'not_connected'),
    native('tmdb', 'api_key', 'connected'),
    native('outlook', 'oauth', 'expired', { category: 'email' }),
    native('linkedin', 'oauth', 'revoked'),
    native('slack', 'oauth', 'not_connected', { configured: false }),
    native('dropbox', 'oauth', 'expiring'),
  ]);
  const { nodes } = surfaceRun;
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
  assert.ok(!main.includes('<span class="name">slack</span>'), 'a connector with no configured sign-in is hidden until Show unavailable');
  assert.match(card(main, 'dropbox'), /pill soon">Expiring/);
  surfaceRun.surface.showAll();
  assert.match(card(nodes.get('main').innerHTML, 'slack'), /Not configured/);
  const metrics = nodes.get('identityMetrics').innerHTML;
  assert.match(metrics, /Needs attention<\/span><strong>2</);
  assert.match(metrics, /Available<\/span><strong>6</);
});

test('Reconnect opens the kernel start in the click: nothing requested first, the connect window as the return', async () => {
  const { surface: s, tabs, requested, nodes } = await surface([native('google', 'oauth', 'expired', { label: 'Google' })], {}, { framed: true });
  const before = requested.length;
  const answer = s.startConsent('google');
  assert.equal(answer, undefined, 'nothing is awaited: the whole start happens in the click');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].url, startInWindow('google'));
  assert.equal(tabs[0].target, '_blank');
  assert.equal(tabs[0].opener, null, 'the sign-in window cannot reach back into the hub');
  await settle();
  assert.equal(requested.length, before, 'no request to the start or the kernel authorize route');
  assert.equal(tabs[0].location.href, '', 'the window is never steered afterwards');
  const review = nodes.get('review').innerHTML;
  assert.match(review, /Waiting for Google\. Finish signing in in the window that opened\./);
  assert.ok(review.includes(`<a href="${startInWindow('google').replace(/&/g, '&amp;')}" target="_blank" rel="noopener">No window? Open it again.</a>`));
});

test('a web view that hands back its top window gets the start in the same call and is never steered afterwards', async () => {
  // The Android app's WebView has no second windows: window.open navigates the top window to the address it was given
  // and returns it (content/browser RenderFrameHostImpl::CreateNewWindow kReuse), after spending the click's activation.
  let top;
  const opened = [];
  const run = await surface([native('smartthings', 'oauth', 'expired', { label: 'SmartThings' })], {}, {
    framed: true,
    open: (url, target) => { opened.push([url, target]); return top; },
  });
  top = run.window.top;
  run.surface.startConsent('smartthings');
  await settle();
  assert.deepEqual(opened, [[startInWindow('smartthings'), '_blank']], 'the address goes with the one call the web view honours');
  assert.equal(top.location.href, '', 'no later navigation of the window it handed back');
  assert.equal(top.opener, null);
});

test('with no second window the page itself goes to the start, inside the click, and comes back where the person was', async () => {
  const framed = await surface([native('smartthings', 'oauth', 'expired')], {}, { framed: true, open: () => null });
  framed.surface.startConsent('smartthings');
  assert.equal(framed.window.top.location.href, `/api/connect/smartthings/start?return=${encodeURIComponent('/cockpit/?app=identity')}`, 'the shell goes, and comes back to Identity Hub in the shell');
  const own = await surface([native('smartthings', 'oauth', 'expired')], {}, { open: () => null });
  own.surface.startConsent('smartthings');
  assert.equal(own.window.location.href, `/api/connect/smartthings/start?return=${encodeURIComponent('/api/identity/')}`);
});

test('the connect window\'s answer is said in the kernel\'s words and the list is read again', async () => {
  let connected = false;
  const words = 'Google was not connected. This installation has no public web address yet, so Google cannot be connected here.';
  const run = await surface(() => [native('google', 'oauth', connected ? 'connected' : 'expired', { label: 'Google' })]);
  run.surface.startConsent('google');
  const [channel] = run.channels;
  assert.equal(channel.name, 'oshal-connections');
  channel.onmessage({ data: { type: 'connect-outcome', connector: 'slack', ok: true, text: 'Slack is connected.' } });
  assert.match(run.nodes.get('review').innerHTML, /Waiting for Google/, 'another connector\'s answer is not this one');
  channel.onmessage({ data: { type: 'connect-outcome', connector: 'google', ok: false, text: words } });
  assert.match(run.nodes.get('review').innerHTML, new RegExp(`role="alert"><span class="err">${words.replace(/\./g, '\\.')}</span>`));
  assert.doesNotMatch(run.nodes.get('review').innerHTML, /HTTP 400|invalid_request/);
  assert.equal(channel.closed, true, 'the wait ends');
  assert.equal(run.surface.waiting(), null);
  run.surface.startConsent('google');
  connected = true;
  const lists = run.requested.filter((r) => r.url.startsWith('/api/connect/list')).length;
  run.channels[1].onmessage({ data: { type: 'connect-outcome', connector: 'google', ok: true, text: 'Google is connected.' } });
  await settle();
  assert.match(run.nodes.get('review').innerHTML, /<span class="done">Google is connected\.<\/span>/);
  assert.equal(run.requested.filter((r) => r.url.startsWith('/api/connect/list')).length, lists + 1, 'the list is read again');
  assert.match(card(run.nodes.get('accounts').innerHTML, 'Google'), /pill ok">Connected/);
});

test('shown again after a sign-in in another app, a now-connected card ends the wait; without a channel too', async () => {
  let connected = false;
  const run = await surface(() => [native('smartthings', 'oauth', connected ? 'connected' : 'expired', { label: 'SmartThings' })], {}, { noChannel: true });
  run.surface.startConsent('smartthings');
  const [shown] = run.listeners.visibilitychange;
  await shown();
  assert.match(run.nodes.get('review').innerHTML, /Waiting for SmartThings/, 'still waiting while the grant is lapsed');
  connected = true;
  await shown();
  assert.match(run.nodes.get('review').innerHTML, /<span class="done">SmartThings is connected\.<\/span>/);
  assert.equal(run.surface.waiting(), null);
});

test('a return path keeps only the kernel\'s safe_return shape', async () => {
  const { surface: s } = await surface([]);
  assert.equal(s.returnPath('/cockpit/?app=identity'), '/cockpit/?app=identity');
  for (const hostile of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', 'identity', '/a\r\nb', '', '/' + 'a'.repeat(600)]) {
    assert.equal(s.returnPath(hostile), '', JSON.stringify(hostile));
  }
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
  assert.match(nodes.get('identityMetrics').innerHTML, /Needs attention<\/span><strong>2</);
});
