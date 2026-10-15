/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: on the Movies & TV tab the concierge said no part of Life was usable without connecting
 *   something, although Get a Ride, the travel and food concierges work without one; Life declared no summary, so the concierge knew
 *   only the Movies screen. The COMPILED route (what the runtime mounts) behind the manifest's real declaration: unauthenticated
 *   callers get 401 and nothing else; a signed-in caller gets notes that name every Life tab from the manifest, put Get a Ride
 *   under "Works without a connection", stay within what the kernel's concierge reads (6 notes of at most 280 characters) and
 *   claim no connection state (each tab shows its own).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const yaml = require(path.resolve(PKG, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));

/** @description Load the compiled router with only express stubbed; return a GET caller. */
function route() {
  let handler;
  const router = { get: (p, fn) => { assert.equal(p, '/'); handler = fn; } };
  const file = path.join(PKG, 'routes', 'home-summary.js'), mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))((name) => {
    if (name === 'express') return { Router: () => router };
    throw new Error(`unexpected runtime dependency: ${name}`);
  }, mod, mod.exports);
  mod.exports.createHomeSummaryRoutes();
  return async (oidc) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ oidc }, res);
    return res;
  };
}

test('the manifest declares the summary route the kernel reads, auth-gated and needing no model', () => {
  const declared = manifest.routes.find((r) => r.mountPath === '/api/life/home-summary');
  assert.ok(declared, 'the route is mounted');
  assert.deepEqual([declared.module, declared.factory, declared.auth, declared.requiresAuth, declared.requiresAi],
    ['routes/home-summary.js', 'createHomeSummaryRoutes', 'oidc', true, false]);
  assert.deepEqual(manifest.summary, { path: '/api/life/home-summary', itemsPointer: '/items' });
});

test('unauthenticated callers get 401 and no summary', async () => {
  const get = route();
  for (const oidc of [undefined, { user: { sub: 'a' } }, { isAuthenticated: () => false, user: { sub: 'a' } }, { isAuthenticated: () => true }]) {
    const res = await get(oidc);
    assert.equal(res.code, 401);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('a signed-in caller learns which parts work without a connection, for every Life tab', async () => {
  const res = await route()({ isAuthenticated: () => true, user: { sub: 'alice' } });
  assert.equal(res.code, 200);
  assert.deepEqual([res.body.metrics, res.body.tiles], [[], []], 'Life owns no data and states no figures');
  const notes = res.body.items.map((i) => i.text);
  assert.ok(notes.length >= 1 && notes.length <= 6, `${notes.length} notes; the concierge reads six`);
  for (const note of notes) assert.ok(note.length <= 280, `a note is cut by the concierge past 280 characters: ${note}`);
  const all = notes.join('\n');
  for (const tab of manifest.ui.static) assert.ok(all.includes(tab.label), `the summary covers the ${tab.label} tab`);
  assert.match(notes.find((n) => n.startsWith('Works without a connection')) || '', /Get a Ride/);
  assert.match(all, /shown on its own tab/);
  // The store's no-rail providers are never something to connect (scripts/check-connector-copy.mjs).
  const { NO_RAIL_PROVIDERS } = await import(path.resolve(PKG, '..', 'scripts', 'check-connector-copy.mjs'));
  for (const name of NO_RAIL_PROVIDERS) {
    assert.doesNotMatch(all, new RegExp(`\\b${name}\\s+(connection|key|token|account)\\b|\\b(connect|add)\\s+(your\\s+)?${name}\\b`, 'i'), name);
  }
  assert.doesNotMatch(all, /\b(is|are) not connected\b|\bconnected here\b/i, 'no claim about this installation\'s connection state');
});
