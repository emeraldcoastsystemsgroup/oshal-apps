/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sync now with no Slack connection says so. The COMPILED route (routes/feeds-routes.js, framework imports stubbed, no token for the caller) answers POST /sync with 409 {error:'not connected', detail, connectUrl}, not a 404; the surface's own doSync, run in a sandbox against that answer, a refusal and a success, writes a visible note each time. Before, doSync ignored the status and swallowed errors, so the button changed nothing on screen.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const PKG = path.join(__dirname, '..');

/** The compiled router with its framework imports stubbed; the caller holds no Slack token. */
function routes() {
  const handlers = {};
  const add = (method) => (route, ...fns) => { handlers[`${method} ${route}`] = fns[fns.length - 1]; };
  const STUBS = {
    express: { Router: () => ({ get: add('GET'), post: add('POST'), put: add('PUT'), use() {} }) },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/feeds-indexing': { indexUserFeed: async () => { throw new Error('must not index without a token'); }, getFeedSettings: async () => ({}), updateFeedSettings: async () => ({}), maybeSyncOnView() {} },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) { return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : original.call(this, request, ...rest); };
  try {
    delete require.cache[require.resolve(path.join(PKG, 'routes', 'feeds-routes.js'))];
    require(path.join(PKG, 'routes', 'feeds-routes.js')).createFeedsRoutes({ pool: {}, appPackageDir: PKG });
  } finally { Module._load = original; }
  return handlers;
}

async function call(handler, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    handler(req, res);
  });
}

/** The surface's doSync and syncNote, run against a fetch that answers `[status, body]` for POST /sync. */
async function pressSync(answer) {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'feeds.html'), 'utf8');
  const cut = (name) => { const start = html.search(new RegExp(`(async )?function ${name}\\(`)); let depth = 0;
    for (let i = html.indexOf('{', html.indexOf(')', start)); i < html.length; i += 1) { if (html[i] === '{') depth += 1; else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1); }
    throw new Error(name); };
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { textContent: id === 'syncBtn' ? 'Sync now' : '', hidden: id === 'syncNote', disabled: false, classes: new Set(), classList: { toggle(c, on) { on ? this.owner.classes.add(c) : this.owner.classes.delete(c); } } }); const e = els.get(id); e.classList.owner = e; return e; };
  const sandbox = { $: el, Number, load: async () => {}, fetch: async () => ({ status: answer[0], ok: answer[0] < 300, json: async () => answer[1] }) };
  vm.createContext(sandbox);
  new vm.Script(`${cut('syncNote')}\n${cut('doSync')}\nglobalThis.doSync = doSync;`).runInContext(sandbox);
  await sandbox.doSync();
  const note = el('syncNote');
  return { text: note.textContent, hidden: note.hidden, bad: note.classes.has('bad'), button: el('syncBtn') };
}

test('POST /sync without a Slack connection is a 409 that names what to do', async () => {
  const answer = await call(routes()['POST /sync'], { oidc: { isAuthenticated: () => true, user: { sub: 'alice' } } });
  assert.equal(answer.status, 409);
  assert.deepEqual(answer.body, { error: 'not connected', detail: 'Slack is not connected for this account: connect Slack, then sync again.', connectUrl: '/api/connect/slack/start' });
});

test('Sync now shows the not-connected answer, a refusal and a success on screen', async () => {
  const notConnected = await pressSync([409, { error: 'not connected' }]);
  assert.equal(notConnected.hidden, false);
  assert.equal(notConnected.text, 'Slack is not connected, so there is nothing to sync. Press Connect Slack below, then Sync now again.');
  assert.equal(notConnected.bad, true);
  assert.equal(notConnected.button.textContent, 'Sync now');
  assert.equal(notConnected.button.disabled, false);
  assert.equal((await pressSync([500, { error: 'slack rate limited' }])).text, 'Sync failed: slack rate limited (HTTP 500).');
  const ok = await pressSync([200, { ok: true, stored: 3 }]);
  assert.equal(ok.text, 'Synced: 3 new messages indexed.');
  assert.equal(ok.bad, false);
});

test('the closed settings drawer is hidden and casts no shadow', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'feeds.html'), 'utf8');
  assert.match(html, /\.drawer:not\(\.open\) \{ visibility:hidden; box-shadow:none;/);
});
