/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Travel concierge turn with no Duffel rail, through the COMPILED route module. The Duffel double answers like the native kernel (status not_connected; any search refuses 503 and would fail the call). A turn that carries a search runs none, opens no fare watch even when the model asks for one, and its prompt says fares cannot be searched or watched here, forbids "connect Duffel", and reads VPS as an airport. With a rail the search still runs. Red on the previous route, which searched without asking and offered fare watches it could not keep.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The route module now requires ./travel-handoff (the search links it answers with where there is no Duffel rail); the loader serves it.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTE_FILE = path.join(__dirname, '..', 'routes', 'travel-routes.js');

/** An in-memory pool answering the chat route's SQL; every statement recorded. */
function fakePool() {
  const sql = [];
  const rows = (r) => ({ rows: r, rowCount: r.length });
  return {
    sql,
    async query(text, params = []) {
      const s = String(text).trim();
      sql.push(s);
      if (/^INSERT INTO travel_conversations/.test(s)) return rows([{ conversation_id: 'conv-1' }]);
      if (/^SELECT role, content FROM travel_messages/.test(s)) return rows([{ role: 'user', content: params[0] }]);
      if (/^INSERT INTO travel_watches/.test(s)) return rows([{ watch_id: 'w1' }]);
      return rows([]);
    },
  };
}

/** Load the compiled route with stubbed framework imports and a scripted orchestrator. */
function load({ status, reply }) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const calls = [];
  const prompts = [];
  const router = { get(p, h) { handlers.get.set(p, h); }, post(p, h) { handlers.post.set(p, h); }, delete(p, h) { handlers.delete.set(p, h); } };
  const stubs = {
    express: { Router: () => router }, path, fs, crypto: { randomUUID: () => 'id' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({}) },
    '@/app/routes/provider-operation-clients': {
      runDuffelProviderOperation: async (_c, args) => {
        if (args[0] === 'status') return status;
        calls.push(args[0]);
        if (status.mode === 'not_connected') throw Object.assign(new Error('Duffel travel search is unavailable in this native runtime'), { status: 503 });
        return { source: 'duffel', items: [{ id: 'off_1', airline: 'Delta', price: 212, currency: 'USD', slices: [] }] };
      },
    },
    './travel-handoff': require(path.join(__dirname, '..', 'routes', 'travel-handoff.js')),
    '@/app/routes/travel-farewatch': { ensureTravelSchema: async () => {}, routeKeyFor: () => 'flight:VPS-DCA', recordObservations: async () => {}, priceRead: async () => ({ verdict: 'unknown' }) },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    (id) => { if (id in stubs) return stubs[id]; throw new Error(`unexpected require: ${id}`); }, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const orchestrator = { async processMessage(_id, prompt) { prompts.push(prompt); return { response: JSON.stringify(reply) }; } };
  const pool = fakePool();
  mod.exports.createTravelRoutes({ pool, appPackageDir: path.join(__dirname, '..', 'tools'), orchestrator });
  return { handlers, calls, prompts, pool, exports: mod.exports };
}

async function chat(t, body) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await t.handlers.post.get('/chat')({ oidc: { isAuthenticated: () => true, user: { sub: 'traveller-a' } }, body, query: {}, path: '/chat' }, res);
  return res;
}

const SEARCH = { origin: 'VPS', destination: 'DCA', departDate: '2026-11-20' };
const NATIVE = { configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Duffel travel search', reason: 'Duffel is not connected.' };

test('with no Duffel rail the turn runs no search, opens no watch, and says so without "connect Duffel"', async () => {
  const t = load({ status: NATIVE, reply: { say: 'Fares cannot be searched here; VPS is Destin–Fort Walton Beach.', show: ['off_1'], watch: ['off_1'] } });
  const res = await chat(t, { message: 'Watch fares from VPS to DCA', kind: 'flight', search: SEARCH });
  assert.equal(res.code, 200);
  assert.deepEqual(t.calls, [], 'no search reached the refusing Duffel operation');
  assert.deepEqual([res.body.cards, res.body.watched], [[], []]);
  assert.ok(!t.pool.sql.some((s) => /INSERT INTO travel_watches/.test(s)), 'no fare watch is written');
  assert.match(t.prompts[0], /THIS INSTALLATION: This installation has no Duffel rail \(no Duffel connector exists here\)/);
  assert.match(t.prompts[0], /Do not offer a fare watch/);
  assert.match(t.prompts[0], /never tell the traveller to connect Duffel/);
  assert.match(t.prompts[0], /VPS is Destin–Fort Walton Beach, Florida/);
});

test('with a Duffel rail the search runs and the prompt carries no installation warning', async () => {
  const t = load({ status: { configured: true, mode: 'live', live: true }, reply: { say: 'Delta at $212.', show: ['off_1'] } });
  const res = await chat(t, { message: 'VPS to DCA', kind: 'flight', search: SEARCH });
  assert.equal(res.code, 200);
  assert.deepEqual(t.calls, ['flights']);
  assert.equal(res.body.cards.length, 1);
  assert.doesNotMatch(t.prompts[0], /THIS INSTALLATION/);
});
