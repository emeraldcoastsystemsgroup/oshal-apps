/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1: with no Plaid keys the shipped connect screen (renderConnect, run from the page) and the Link routes say bank linking is not set up on this installation (and Demo connect outside Sandbox says why), never an operator setting name, and the page no longer promises Sandbox Demo-connect beside disabled buttons.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | T8: Link retries without the return address on INVALID_FIELD; removeItem answers providerDisconnected (ITEM_NOT_FOUND counts, INVALID_ACCESS_TOKEN refuses with the reconnect-or-dashboard message); Disconnect reports an orphaned link honestly and keeps the row on INVALID_ACCESS_TOKEN (409); Sync skips an unreadable link with a note and still syncs the others.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Real Plaid Link on Finance. Pins: Link asks for transactions with investments optional and sends PLAID_REDIRECT_URI when set; balances read /accounts/get; transactions page past one page; removeItem treats an already-gone item as removed and surfaces any other refusal. The compiled routes list each linked institution in /status, disconnect at Plaid before deleting the row, keep the row on a Plaid refusal (502), remove an unreadable legacy link locally, clear the saved snapshot, and never touch another person's link. The page offers Add account, Disconnect per institution and resumes an OAuth redirect with the saved link token. Provider responses are recorded doubles shaped like Plaid's documented fields; no credential or network is used. Run: node --test tests/plaid-link.test.cjs
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const PLAID = path.join(ROOT, 'routes', 'finance-plaid.js');
const ROUTES = path.join(ROOT, 'routes', 'finance-routes.js');

/** Load the compiled Plaid module against a recorded fetch double. */
function loadPlaid(answer, env = {}) {
  const calls = [];
  const saved = { fetch: global.fetch, env: { ...process.env } };
  Object.assign(process.env, { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'fixture-client', PLAID_SECRET: 'fixture-secret' }, env);
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ path: new URL(url).pathname, body });
    const [status, json] = answer(new URL(url).pathname, body);
    return { ok: status < 300, status, json: async () => json };
  };
  delete require.cache[PLAID];
  const plaid = require(PLAID);
  const restore = () => { global.fetch = saved.fetch; process.env = saved.env; delete require.cache[PLAID]; };
  return { plaid, calls, restore };
}

test('Link lists banks without brokerage products and carries the OAuth return address when configured', async () => {
  const { plaid, calls, restore } = loadPlaid(() => [200, { link_token: 'link-sandbox-fixture' }],
    { PLAID_REDIRECT_URI: 'https://oshal.example/api/finance/' });
  try {
    assert.equal(await plaid.createLinkToken('person-1'), 'link-sandbox-fixture');
    assert.deepEqual(calls[0].body.products, ['transactions']);
    assert.deepEqual(calls[0].body.optional_products, ['investments']);
    assert.equal(calls[0].body.redirect_uri, 'https://oshal.example/api/finance/');
    assert.equal(calls[0].body.user.client_user_id, 'person-1');
  } finally { restore(); }
  const bare = loadPlaid(() => [200, { link_token: 'link-sandbox-fixture' }], { PLAID_REDIRECT_URI: '' });
  try {
    await bare.plaid.createLinkToken('person-1');
    assert.equal('redirect_uri' in bare.calls[0].body, false);
  } finally { bare.restore(); }
});

test('sync reads item accounts and pages transactions through the window', async () => {
  const txn = (i) => ({ transaction_id: `t${i}`, amount: 10, date: '2026-10-01', name: 'Coffee', personal_finance_category: { primary: 'FOOD_AND_DRINK' } });
  const { plaid, calls, restore } = loadPlaid((p, body) => {
    if (p === '/accounts/get') return [200, { accounts: [{ account_id: 'a', name: 'Checking', type: 'depository', balances: { current: 1200, iso_currency_code: 'USD' } }] }];
    if (p === '/investments/holdings/get') return [400, { error_code: 'PRODUCTS_NOT_SUPPORTED' }];
    const offset = body.options.offset;
    const rows = Array.from({ length: Math.max(0, Math.min(500, 640 - offset)) }, (_, i) => txn(offset + i));
    return [200, { transactions: rows, total_transactions: 640 }];
  });
  try {
    const agg = await plaid.fetchFinanceAggregate([{ accessToken: 'access-sandbox-fixture', institution: 'Fixture Bank' }], 90);
    assert.equal(agg.netWorth.net, 1200);
    assert.equal(agg.topSpending[0].count, 640);
    assert.deepEqual(calls.filter((c) => c.path === '/transactions/get').map((c) => c.body.options.offset), [0, 500]);
    assert.equal(calls.some((c) => c.path === '/accounts/balance/get'), false);
  } finally { restore(); }
});

test('removeItem disconnects, treats an already-gone item as removed and surfaces other refusals', async () => {
  let code = null;
  const { plaid, calls, restore } = loadPlaid(() => (code ? [400, { error_code: code, error_message: 'x' }] : [200, { request_id: 'r' }]));
  try {
    await plaid.removeItem('access-sandbox-fixture');
    assert.deepEqual(calls[0], { path: '/item/remove', body: { client_id: 'fixture-client', secret: 'fixture-secret', access_token: 'access-sandbox-fixture' } });
    code = 'ITEM_NOT_FOUND';
    assert.deepEqual(await plaid.removeItem('access-sandbox-gone'), { providerDisconnected: true, reason: 'ITEM_NOT_FOUND' }, 'nothing left at Plaid counts as disconnected');
    code = 'INVALID_ACCESS_TOKEN';
    await assert.rejects(plaid.removeItem('access-sandbox-stale'), (err) => err.plaidCode === 'INVALID_ACCESS_TOKEN'
      && /Reconnect the bank/.test(err.message) && /Plaid dashboard/.test(err.message) && /billed/.test(err.message),
      'after a PLAID_ENV change the item may still be live and billed: never "already removed"');
    code = 'INTERNAL_SERVER_ERROR';
    await assert.rejects(plaid.removeItem('access-sandbox-fixture'), (err) => err.plaidCode === 'INTERNAL_SERVER_ERROR');
  } finally { restore(); }
});

test('Link falls back to pop-up OAuth when the return address is not registered (INVALID_FIELD)', async () => {
  const { plaid, calls, restore } = loadPlaid((p, body) => ('redirect_uri' in body
    ? [400, { error_code: 'INVALID_FIELD', error_message: 'OAuth redirect URI must be configured in the developer dashboard.' }]
    : [200, { link_token: 'link-sandbox-popup' }]), { PLAID_REDIRECT_URI: 'https://oshal.example/api/finance/' });
  try {
    assert.equal(await plaid.createLinkToken('person-1'), 'link-sandbox-popup');
    assert.deepEqual(calls.map((c) => 'redirect_uri' in c.body), [true, false], 'one retry, without the return address');
  } finally { restore(); }
  const other = loadPlaid(() => [400, { error_code: 'INVALID_API_KEYS', error_message: 'x' }], { PLAID_REDIRECT_URI: 'https://oshal.example/api/finance/' });
  try {
    await assert.rejects(other.plaid.createLinkToken('person-1'), (err) => err.plaidCode === 'INVALID_API_KEYS');
    assert.equal(other.calls.length, 1, 'any other refusal is not retried');
  } finally { other.restore(); }
});

/** A per-person table double that answers the route's SQL and records every statement. */
function financePool(rows) {
  const statements = [];
  const pool = {
    statements,
    async query(text, values = []) {
      statements.push({ text, values });
      if (/^SELECT item_id, institution, linked_at FROM oshal_finance_items/.test(text)) return { rows: rows.filter((r) => r.user_sub === values[0]) };
      if (/^SELECT access_token FROM oshal_finance_items/.test(text)) return { rows: rows.filter((r) => r.item_id === values[0] && r.user_sub === values[1]) };
      if (/^SELECT institution, access_token FROM oshal_finance_items/.test(text)) return { rows: rows.filter((r) => r.user_sub === values[0]) };
      if (/^DELETE FROM oshal_finance_items/.test(text)) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].item_id === values[0] && rows[i].user_sub === values[1]) rows.splice(i, 1);
        return { rowCount: before - rows.length, rows: [] };
      }
      if (/^SELECT COUNT/.test(text)) return { rows: [{ n: rows.filter((r) => r.user_sub === values[0]).length }] };
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

/** Build the compiled router over `pool`, with framework modules replaced by recorded doubles. */
function loadRoutes(pool, removeItem, fetchFinanceAggregate = async () => ({ notes: [], netWorth: { assets: 0, liabilities: 0, net: 0 }, accounts: [], holdings: [] })) {
  const handlers = {};
  const record = (method) => (route, handler) => { handlers[`${method} ${route}`] = handler; };
  const doubles = {
    express: { Router: () => ({ get: record('GET'), post: record('POST'), delete: record('DELETE') }) },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => null },
    '@/features/payments': { getPaymentAdapter: () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({}) },
    '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
    './finance-plaid': { plaidConfigured: () => true, plaidEnv: () => 'sandbox', removeItem, fetchFinanceAggregate },
    './session-crypto': {
      encryptSessionValue: (v) => v,
      decryptSessionValue: (v) => { if (!v.startsWith('vault:')) throw new Error('legacy encoding'); return v; },
    },
  };
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === ROUTES && request in doubles) return doubles[request];
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[ROUTES];
    require(ROUTES).createFinanceRoutes({ pool, appPackageDir: ROOT });
  } finally { Module._load = original; delete require.cache[ROUTES]; }
  return handlers;
}

/** Call one route handler as a signed-in caller and capture the response. */
async function call(handler, sub, params = {}) {
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ oidc: { user: { sub } }, params, body: {} }, res);
  return res;
}

const linked = () => [
  { item_id: 'item-a', user_sub: 'alice', institution: 'First Platypus Bank', access_token: 'vault:a', linked_at: '2026-10-12T05:00:00Z' },
  { item_id: 'item-c', user_sub: 'alice', institution: 'Legacy Bank', access_token: 'iv:tag:legacy-envelope', linked_at: null },
  { item_id: 'item-b', user_sub: 'bob', institution: 'Bob Bank', access_token: 'vault:b', linked_at: null },
];

test('status lists each of the caller\'s linked institutions and nobody else\'s', async () => {
  const pool = financePool(linked());
  const res = await call(loadRoutes(pool, async () => {})['GET /status'], 'alice');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, [
    { itemId: 'item-a', institution: 'First Platypus Bank', linkedAt: '2026-10-12T05:00:00Z' },
    { itemId: 'item-c', institution: 'Legacy Bank', linkedAt: null },
  ]);
  assert.equal(res.body.connected, 2);
});

test('disconnect removes the item at Plaid first, then the row and the stale snapshot', async () => {
  const rows = linked(); const pool = financePool(rows); const removed = [];
  const routes = loadRoutes(pool, async (token) => { removed.push(token); });
  const res = await call(routes['DELETE /items/:itemId'], 'alice', { itemId: 'item-a' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, removed: 1, providerDisconnected: true, remaining: 1 });
  assert.deepEqual(removed, ['vault:a']);
  const order = pool.statements.map((s) => s.text.split(' ').slice(0, 3).join(' '));
  assert.ok(order.indexOf('DELETE FROM oshal_finance_items') > order.indexOf('SELECT access_token FROM'));
  assert.ok(pool.statements.some((s) => /^DELETE FROM oshal_finance_data WHERE user_sub = \$1/.test(s.text) && s.values[0] === 'alice'));
  assert.equal(rows.some((r) => r.item_id === 'item-a'), false);
});

test('a Plaid refusal keeps the link; an unreadable legacy link is removed locally; another person\'s link is not found', async () => {
  const rows = linked(); const pool = financePool(rows);
  const refusing = loadRoutes(pool, async () => { const err = new Error('INTERNAL_SERVER_ERROR: x'); err.plaidCode = 'INTERNAL_SERVER_ERROR'; throw err; });
  const refused = await call(refusing['DELETE /items/:itemId'], 'alice', { itemId: 'item-a' });
  assert.equal(refused.statusCode, 502);
  assert.equal(refused.body.error, 'plaid_remove_failed');
  assert.equal(rows.some((r) => r.item_id === 'item-a'), true, 'the bank stays linked when Plaid did not confirm');
  const calls = [];
  const routes = loadRoutes(pool, async (token) => { calls.push(token); });
  const legacy = await call(routes['DELETE /items/:itemId'], 'alice', { itemId: 'item-c' });
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.body.providerDisconnected, false);
  assert.deepEqual(calls, []);
  const foreign = await call(routes['DELETE /items/:itemId'], 'alice', { itemId: 'item-b' });
  assert.equal(foreign.statusCode, 404);
  assert.equal(rows.some((r) => r.item_id === 'item-b'), true);
});

test('Disconnect says when Plaid was not told, keeps the link when Plaid no longer accepts the credential', async () => {
  const rows = linked(); const pool = financePool(rows);
  const orphan = loadRoutes(pool, async () => ({ removed: true, providerDisconnected: false, reason: 'CREDENTIAL_UNAVAILABLE', message: 'The sealed bank credential is gone; remove it in the Plaid dashboard.' }));
  const local = await call(orphan['DELETE /items/:itemId'], 'alice', { itemId: 'item-a' });
  assert.equal(local.statusCode, 200);
  assert.equal(local.body.providerDisconnected, false, 'never claims Plaid was told');
  assert.match(local.body.note, /Plaid dashboard/);
  assert.equal(rows.some((r) => r.item_id === 'item-a'), false, 'the orphaned row is gone locally');
  const kept = linked(); const keptPool = financePool(kept);
  const refusing = loadRoutes(keptPool, async () => { const err = new Error('Reconnect the bank, or remove the item in the Plaid dashboard'); err.plaidCode = 'INVALID_ACCESS_TOKEN'; throw err; });
  const res = await call(refusing['DELETE /items/:itemId'], 'alice', { itemId: 'item-a' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'plaid_reconnect_needed');
  assert.match(res.body.message, /Plaid dashboard/);
  assert.equal(kept.some((r) => r.item_id === 'item-a'), true, 'the link stays: the item may still be live and billed');
});

test('Sync skips a link whose stored credential cannot be read and still syncs the others', async () => {
  const pool = financePool(linked()); const seen = [];
  const routes = loadRoutes(pool, async () => ({ providerDisconnected: true }), async (items) => { seen.push(items); return { notes: ['holdings unavailable for First Platypus Bank (PRODUCTS_NOT_SUPPORTED)'], netWorth: { assets: 1, liabilities: 0, net: 1 }, accounts: [{}], holdings: [] }; });
  const res = await call(routes['POST /sync'], 'alice');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(seen, [[{ institution: 'First Platypus Bank', accessToken: 'vault:a' }]], 'only the readable link is read');
  assert.deepEqual(res.body.notes, ['Legacy Bank skipped: its stored credential cannot be read. Disconnect it and link the bank again.',
    'holdings unavailable for First Platypus Bank (PRODUCTS_NOT_SUPPORTED)']);
  assert.ok(pool.statements.some((s) => /^INSERT INTO oshal_finance_data/.test(s.text)), 'the aggregate is saved');
});

test('the page offers Add account, Disconnect per institution and resumes an OAuth redirect', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tools', 'finance.html'), 'utf8');
  assert.match(html, /id="addBtn"[^>]*>Add account</);
  assert.match(html, /\$\('addBtn'\)\.onclick = startLink;/);
  assert.match(html, /api\('\/items\/' \+ encodeURIComponent\(itemId\), \{ method: 'DELETE' \}\)/);
  assert.match(html, /has\('oauth_state_id'\)/);
  assert.match(html, /receivedRedirectUri/);
  assert.match(html, /if \(await resumeOAuth\(\)\) return;/);
  assert.match(html, /\$\{escapeHtml\(it\.institution\)\}/);
  assert.match(html, /user_good \/ pass_good/);
});

test('with no Plaid keys the connect screen and Link routes speak to a person, never name a setting', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tools', 'finance.html'), 'utf8');
  const start = html.indexOf('function renderConnect(status)');
  const source = html.slice(start, html.indexOf('\n}\n', start) + 3);
  const nodes = {};
  const main = { innerHTML: '' };
  const $ = (id) => (nodes[id] ||= { style: {}, onclick: null });
  const escapeHtml = (v) => String(v);
  new Function('main', '$', 'escapeHtml', 'startLink', 'demoConnect', `${source}; renderConnect({ configured: false, env: 'sandbox' });`)(
    main, $, escapeHtml, () => {}, () => {});
  assert.match(main.innerHTML, /Bank linking is not set up on this installation yet/);
  assert.doesNotMatch(main.innerHTML, /PLAID_|user_good|uses Plaid Sandbox/);
  new Function('main', '$', 'escapeHtml', 'startLink', 'demoConnect', `${source}; renderConnect({ configured: true, env: 'sandbox' });`)(
    main, $, escapeHtml, () => {}, () => {});
  assert.match(main.innerHTML, /uses Plaid Sandbox/);
  const routes = fs.readFileSync(ROUTES, 'utf8');
  assert.doesNotMatch(routes, /message: '[^']*PLAID_/);
});
