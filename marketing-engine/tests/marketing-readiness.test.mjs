/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Readiness probes over the COMPILED route (routes/marketing-readiness.js), loaded with an explicit stub for each of its three runtime imports: the session gate, owner-scoped reads, the armed-means-cap-at-least-one rule, both halves of the sender check, and honest degradation when a read fails.
 *
 * Dependency-free `node --test` (store-CI contract): no DB, no express install, no network. Why:
 * these answers drive the Marketing Suite setup dashboard. A probe that reads another owner's
 * rows, reports "armed" for a channel whose daily cap is 0 (a cap of zero means NOTHING sends), or
 * leaks a database error into the page is a defect the setup page would present as progress.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(packageDir, 'routes', 'marketing-readiness.js'), 'utf8');

/** Load the compiled module with every runtime import stubbed; records which ones it asked for. */
function loadReadiness({ query, connection = null } = {}) {
  let handler;
  const imported = [];
  const module = { exports: {} };
  const requireStub = (name) => {
    imported.push(name);
    if (name === 'express') return { Router: () => ({ get: (_path, fn) => { handler = fn; } }) };
    if (name === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {} }) };
    if (name === '@/app/routes/connector-tenancy') return { resolveConnectionRow: async () => connection };
    throw new Error(`unexpected runtime import: ${name}`);
  };
  new Function('require', 'module', 'exports', source)(requireStub, module, module.exports);
  const seen = [];
  const ctx = { pool: { query: async (text, values) => { seen.push({ text, values }); return query ? query(text, values) : { rows: [] }; } } };
  module.exports.createMarketingReadinessRoutes(ctx);
  const call = async (oidc = { user: { sub: 'alice' }, isAuthenticated: () => true }) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; } };
    await handler({ oidc, query: { user_sub: 'mallory' } }, res);
    return res;
  };
  return { call, imported, seen, exports: module.exports };
}

/** Answer the campaign count query, then the channel query, from fixtures. */
function pool({ campaigns = [{ total: 0, active: 0 }], channels = [] } = {}) {
  return (text) => {
    if (text.includes('oshal_marketing_campaigns')) return { rows: campaigns };
    if (text.includes('oshal_marketing_channel_authorizations')) return { rows: channels };
    throw new Error(`unexpected query: ${text.slice(0, 40)}`);
  };
}

test('the compiled probe module imports only express, the logger and connector tenancy', () => {
  const { imported, exports } = loadReadiness();
  assert.deepEqual([...new Set(imported)].sort(), ['@/app/routes/connector-tenancy', '@/shared/logger', 'express']);
  assert.equal(typeof exports.createMarketingReadinessRoutes, 'function');
  assert.equal(typeof exports.readMarketingReadiness, 'function');
});

test('an unauthenticated caller is refused before any read', async () => {
  const { call, seen } = loadReadiness({ query: () => assert.fail('read before authentication') });
  for (const oidc of [null, { user: {} }]) {
    const res = await call(oidc);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.equal(seen.length, 0);
});

test('every read is scoped to the session subject, never a query-string user', async () => {
  const { call, seen } = loadReadiness({ query: pool() });
  await call();
  assert.equal(seen.length, 2);
  for (const { text, values } of seen) {
    assert.match(text, /user_sub = \$1/);
    assert.equal(values[0], 'alice');
    assert.equal(values.includes('mallory'), false);
  }
});

test('the campaign probe counts the owner\'s campaigns honestly', async () => {
  const empty = await loadReadiness({ query: pool() }).call();
  assert.equal(empty.body.campaign.ready, false);
  assert.match(empty.body.campaign.detail, /No campaign yet/);

  const some = await loadReadiness({ query: pool({ campaigns: [{ total: 2, active: 1 }] }) }).call();
  assert.equal(some.body.campaign.ready, true);
  assert.equal(some.body.campaign.detail, '2 campaigns, 1 active.');
});

test('armed means enabled AND a daily cap of at least one', async () => {
  const armed = await loadReadiness({ query: pool({ channels: [{ channel: 'bluesky', enabled: true, daily_cap: 3 }] }) }).call();
  assert.equal(armed.body.channels.ready, true);
  assert.match(armed.body.channels.detail, /bluesky/);

  const capZero = await loadReadiness({ query: pool({ channels: [{ channel: 'email', enabled: true, daily_cap: 0 }] }) }).call();
  assert.equal(capZero.body.channels.ready, false, 'a cap of zero sends nothing, so it is not armed');
  assert.match(capZero.body.channels.detail, /cap of 0|zero means/i);

  const off = await loadReadiness({ query: pool({ channels: [{ channel: 'email', enabled: false, daily_cap: 5 }] }) }).call();
  assert.equal(off.body.channels.ready, false);
  assert.match(off.body.channels.detail, /Every channel is off/);
});

test('the sender probe needs both the address and the connection', async () => {
  const original = process.env.MARKETING_EMAIL_FROM;
  try {
    process.env.MARKETING_EMAIL_FROM = 'oshal <news@example.com>';
    const both = await loadReadiness({ query: pool(), connection: { connection_id: 'c1' } }).call();
    assert.equal(both.body.sender.ready, true);

    const noConnection = await loadReadiness({ query: pool(), connection: null }).call();
    assert.equal(noConnection.body.sender.ready, false);
    assert.match(noConnection.body.sender.detail, /Resend is not connected/);

    process.env.MARKETING_EMAIL_FROM = '   ';
    const noAddress = await loadReadiness({ query: pool(), connection: { connection_id: 'c1' } }).call();
    assert.equal(noAddress.body.sender.ready, false);
    assert.match(noAddress.body.sender.detail, /no sender address/i);

    const neither = await loadReadiness({ query: pool(), connection: null }).call();
    assert.equal(neither.body.sender.ready, false);
    assert.match(neither.body.sender.detail, /No sender address set and Resend is not connected/);
  } finally {
    if (original === undefined) delete process.env.MARKETING_EMAIL_FROM;
    else process.env.MARKETING_EMAIL_FROM = original;
  }
});

test('a failed read degrades to not-ready and never leaks the database error', async () => {
  const { call } = loadReadiness({ query: () => { throw new Error('PRIVATE relation missing'); } });
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.campaign.ready, false);
  assert.equal(res.body.channels.ready, false);
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
});
