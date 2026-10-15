/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the access review builds its inventory from the
 *   connectors.metadata intent with the framework's expired/expiring rules and never reads the framework connection store;
 *   a kernel without the intent answers 503 instead of "no accounts"; outside the kernel the store is still read.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const storeReads = [];
const prompts = [];
const STUBS = {
  express: { Router: () => { const routes = {}; return { routes, use() {}, get: (p, h) => { routes[`GET ${p}`] = h; } }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {} }) },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connector-tenancy': {
    accessibleConnections: async (_pool, sub) => { storeReads.push(sub); return [{ provider: 'github', label: 'me', expiry: null, refresh_token: null }]; },
    isConnectionExpired: () => false, isConnectionExpiring: () => false,
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, _agent, opts) => { prompts.push(opts.text); return { response: '## Review' }; } },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request === './identity-summary') return { createIdentitySummaryRoutes: () => ({}) };
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createIdentityRoutes, nativeInventory } = require('../routes/identity-routes.js');
test.after(() => { Module._load = original; });

async function advice(ctx, kernel = true) {
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } };
  try { await createIdentityRoutes({ pool: {}, ...ctx }).routes['GET /advice']({ oidc: { user: { sub: 'alice' } } }, res); }
  finally { delete process.env.OSHAL_EGRESS; }
  return res;
}

test('the kernel inventory keeps the framework rules: renewable lapses are healthy, revoked or unrenewable lapses are expired', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const day = 86400000;
  const items = nativeInventory([
    { provider: 'google', label: 'work', expires_at_ms: now - 1000, renewable: true, revoked: false },
    { provider: 'twitter', expires_at_ms: now - 1000, renewable: false, revoked: false },
    { provider: 'slack', expires_at_ms: null, renewable: false, revoked: true, shared: true },
    { provider: 'linkedin', expires_at_ms: now + 3 * day, renewable: false, revoked: false },
    { provider: 'spotify', expires_at_ms: now + 30 * day, renewable: false, revoked: false },
  ], now);
  assert.deepEqual(items.map((i) => [i.provider, i.expired, i.expiring, i.refreshable]), [
    ['google', false, false, true], ['twitter', true, false, false], ['slack', true, false, false],
    ['linkedin', false, true, false], ['spotify', false, false, false],
  ]);
  assert.equal(items[0].label, 'work');
  assert.equal(items[2].shared, true);
  assert.equal(items[1].expiry, new Date(now - 1000).toISOString());
  assert.ok(!JSON.stringify(items).match(/token|secret/i));
});

test('under the kernel the advice reads connection metadata, never the framework store', async () => {
  const intents = [];
  const res = await advice({ intent: async (name, input) => { intents.push([name, input]); return { connections: [{ provider: 'gmail', label: 'home', expires_at_ms: null, renewable: false, revoked: false }] }; } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { advice: '## Review', count: 1, empty: false });
  assert.deepEqual(intents, [['connectors.metadata', {}]]);
  assert.deepEqual(storeReads, []);
  assert.match(prompts.at(-1), /"provider": "gmail"/);
  const none = await advice({ intent: async () => ({ connections: [] }) });
  assert.equal(none.body.empty, true);
});

test('a kernel without connection metadata answers 503, and outside the kernel the store is read', async () => {
  const missing = await advice({});
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.error, 'connections_unavailable');
  const legacy = await advice({}, false);
  assert.equal(legacy.statusCode, 200);
  assert.deepEqual(storeReads, ['alice']);
});
