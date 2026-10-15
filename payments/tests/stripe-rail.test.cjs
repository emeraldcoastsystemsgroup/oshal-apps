/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | T8: a balance answer without a boolean livemode (frank) reads as LIVE, testMode false; red when the rail treats anything but livemode:true as test.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The Stripe rail against a local fake Stripe server (real HTTP, no network): request shapes (form-encoded Checkout Session, charges list, full refund), mode from Stripe's own livemode (test / live / unknown / rejected / not connected), the two-step confirmation (confirm, then confirmLive for any non-test key) answered before anything is sent, each caller reaching Stripe only with their own key and their own audit rows, and no key text in any answer even when Stripe echoes one.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');

/** Fixture keys are assembled at run time so the source holds nothing a secret scanner reads as a Stripe key. */
const fakeKey = (kind, mode, name) => [kind, mode, name].join('_');
const KEYS = {
  alice: fakeKey('rk', 'test', 'fixtureAliceKey0001'),   // Stripe answers livemode:false
  bob: fakeKey('rk', 'live', 'fixtureBobKey0002'),       // Stripe answers livemode:true
  carol: fakeKey('rk', 'test', 'fixtureCarolNoBalance'), // Stripe refuses the balance read (403): mode unknown
  dave: fakeKey('sk', 'test', 'fixtureDaveRevoked'),     // Stripe answers 401 and echoes part of the key
  frank: fakeKey('rk', 'test', 'fixtureFrankNoLivemode'), // Stripe's balance carries no livemode at all: LIVE, fail safe
};

/** A fake api.stripe.com: records each request (never the key itself) and answers per key. */
function fakeStripe() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const auth = String(req.headers.authorization || '');
      const who = Object.keys(KEYS).find((k) => auth === `Bearer ${KEYS[k]}`) || 'none';
      seen.push({ who, method: req.method, url: req.url, type: req.headers['content-type'] || null, form: new URLSearchParams(body) });
      const send = (code, json) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const live = who === 'bob';
      if (who === 'none') return send(401, { error: { type: 'invalid_request_error', message: 'You did not provide an API key.' } });
      if (who === 'dave') return send(401, { error: { type: 'invalid_request_error', message: `Invalid API Key provided: ${fakeKey('sk', 'test', '****************voked')} (${KEYS.dave})` } });
      if (req.url === '/v1/balance') {
        if (who === 'carol') return send(403, { error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions: rak_balance_read.' } });
        if (who === 'frank') return send(200, { object: 'balance', available: [{ amount: 1234, currency: 'usd' }] });
        return send(200, { object: 'balance', livemode: live, available: [{ amount: 1234, currency: 'usd' }] });
      }
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        return send(200, { id: `cs_${live ? 'live' : 'test'}_a1${who}`, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/cs_${who}`,
          status: 'open', payment_status: 'unpaid', amount_total: Number(new URLSearchParams(body).get('line_items[0][price_data][unit_amount]')),
          currency: 'usd', livemode: live, expires_at: 1760000000 });
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/checkout/sessions/')) {
        return send(200, { id: req.url.split('/').pop(), status: 'complete', payment_status: 'paid', amount_total: 2500, currency: 'usd', livemode: live, url: null });
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/charges')) {
        return send(200, { object: 'list', data: [{ id: `ch_${who}1`, amount: 2500, currency: 'usd', status: 'succeeded', paid: true, refunded: false,
          amount_refunded: 0, description: `${who} order`, created: 1760000000, livemode: live, receipt_url: 'https://pay.stripe.com/receipts/x',
          payment_method_details: { card: { last4: '4242' } }, billing_details: { email: 'customer@example.com' } }] });
      }
      if (req.method === 'POST' && req.url === '/v1/refunds') {
        return send(200, { id: 're_1', object: 'refund', status: 'succeeded', amount: 2500, currency: 'usd', charge: new URLSearchParams(body).get('charge') });
      }
      return send(404, { error: { message: 'no such route' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

/** Router stand-in recording every mount. */
function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => { routes.push({ method, route, handler: handlers[handlers.length - 1] }); };
  return { routes, get: add('get'), post: add('post'), put: add('put'), delete: add('delete'), use: add('use') };
}

/** An owner-scoped stand-in for the audit table: rows keyed by (provider, charge_id), reads filtered by user_sub. */
function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(text, values = []) {
      const sql = String(text && text.text ? text.text : text);
      if (/^\s*INSERT INTO oshal_merchant_payments/.test(sql)) {
        const [id, sub, amount, currency, note, status, raw, url, testMode] = values;
        const prior = rows.get(`stripe:${id}`);
        rows.set(`stripe:${id}`, prior ? { ...prior, status, raw } : { id, sub, amount, currency, note, status, raw, url, testMode });
        return { rowCount: 1, rows: [] };
      }
      if (/SELECT 1 FROM oshal_merchant_payments WHERE provider = 'stripe'/.test(sql)) {
        const row = rows.get(`stripe:${values[0]}`);
        return { rowCount: row && row.sub === values[1] ? 1 : 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

const logs = [];
/** Load the compiled routes with framework stand-ins; the logger records every line so the test can search it for keys. */
function loadRoutes() {
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a), debug() {} };
  const stubs = {
    express: { Router: fakeRouter },
    '@/shared/logger': { createChildLogger: () => logger },
    '@/features/payments': { listMerchantProviders: () => [], getMerchantAdapter: () => null },
    '@/app/routes/connector-tenancy': { accessibleConnections: async () => [] },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/security/explicit-write-confirmation': {
      confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: action }),
      hasExplicitWriteConfirmation: (body) => Boolean(body && typeof body === 'object' && body.confirm === true),
    },
  };
  const dir = path.resolve(__dirname, '../routes');
  for (const f of ['payments-routes.js', 'stripe-routes.js', 'stripe-rail.js']) delete require.cache[path.join(dir, f)];
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : load.call(this, request, ...rest);
  };
  try { return require(path.join(dir, 'payments-routes.js')); } finally { Module._load = load; }
}

/** One payments router whose Stripe transport sends each caller's OWN key to the fake (as the kernel places it). */
async function harness() {
  const stripe = await fakeStripe();
  const pool = fakePool();
  const asked = [];
  const transport = async (sub) => { asked.push(sub); return { fetch: (u, i) => fetch(u, i), base: stripe.base, credential: KEYS[sub] || null }; };
  const router = loadRoutes().createPaymentsRoutes({ pool, appPackageDir: path.resolve(__dirname, '..') }, { stripeTransport: transport });
  const call = async (method, route, sub, { body, params, query } = {}) => {
    const handler = router.routes.find((r) => r.method === method && r.route === route).handler;
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
    await handler({ oidc: sub ? { user: { sub } } : undefined, body: body || {}, params: params || {}, query: query || {} }, res);
    return res;
  };
  return { stripe, pool, asked, call, close: () => new Promise((r) => stripe.server.close(r)) };
}

const RETURN = 'https://oshal.example.test/api/payments/';
const order = (extra) => ({ amountCents: 2500, currency: 'usd', description: 'Consulting hour', returnUrl: RETURN, requestId: 'req-1', ...extra });

function assertNoKeys(value) {
  const text = JSON.stringify(value);
  for (const key of Object.values(KEYS)) assert.ok(!text.includes(key), `a key leaked: ${text}`);
  assert.doesNotMatch(text, /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9*]+/, `key-shaped text leaked: ${text}`);
}

test('mode comes from Stripe: test, live, unknown (treated as live), rejected and not connected', async () => {
  const h = await harness();
  try {
    const modes = {};
    for (const sub of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank']) modes[sub] = (await h.call('get', '/stripe/status', sub)).body;
    assert.deepEqual([modes.frank.mode, modes.frank.testMode, modes.frank.connected], ['live', false, true], 'no boolean livemode is LIVE, never test');
    assert.deepEqual([modes.alice.mode, modes.alice.testMode, modes.alice.connected], ['test', true, true]);
    assert.deepEqual(modes.alice.available, [{ amountCents: 1234, currency: 'USD' }]);
    assert.deepEqual([modes.bob.mode, modes.bob.testMode, modes.bob.connected], ['live', false, true]);
    assert.deepEqual([modes.carol.mode, modes.carol.testMode, modes.carol.connected], ['unknown', false, true]);
    assert.match(modes.carol.detail, /treated as LIVE/);
    assert.deepEqual([modes.dave.mode, modes.dave.connected], ['key_rejected', false]);
    assert.deepEqual([modes.erin.mode, modes.erin.connected], ['not_connected', false]);
    assert.ok(h.stripe.seen.every((r) => r.method === 'GET' && r.url === '/v1/balance'), 'the status read is the balance only');
    assert.ok(!h.stripe.seen.some((r) => r.who === 'none'), 'a person with no key never reaches Stripe');
    assertNoKeys(modes);
    const providers = (await h.call('get', '/providers', 'bob')).body.providers;
    assert.deepEqual(providers, [{ provider: 'stripe', connected: true, testMode: false, mode: 'live', sourceLabel: 'Stripe payment page' }]);
  } finally { await h.close(); }
});

test('a Checkout Session is one form-encoded POST with the amount, description and return addresses', async () => {
  const h = await harness();
  try {
    const res = await h.call('post', '/stripe/checkout', 'alice', { body: order({ confirm: true }) });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.session, { id: 'cs_test_a1alice', url: 'https://checkout.stripe.com/c/pay/cs_alice', status: 'open', paymentStatus: 'unpaid',
      amountCents: 2500, currency: 'USD', livemode: false, expiresAt: new Date(1760000000 * 1000).toISOString() });
    const post = h.stripe.seen.find((r) => r.method === 'POST');
    assert.equal(post.url, '/v1/checkout/sessions');
    assert.equal(post.type, 'application/x-www-form-urlencoded');
    assert.deepEqual(Object.fromEntries(post.form), {
      mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '2500', 'line_items[0][price_data][product_data][name]': 'Consulting hour',
      success_url: `${RETURN}?stripe=paid&session={CHECKOUT_SESSION_ID}`, cancel_url: `${RETURN}?stripe=canceled`, 'metadata[oshal_request]': 'req-1' });
    const row = h.pool.rows.get('stripe:cs_test_a1alice');
    assert.deepEqual([row.sub, row.amount, row.status, row.testMode, row.note], ['alice', 2500, 'pending', true, 'Consulting hour']);
    const refreshed = await h.call('get', '/stripe/checkout/:id', 'alice', { params: { id: 'cs_test_a1alice' } });
    assert.equal(refreshed.body.status, 'completed');
    assert.equal(h.pool.rows.get('stripe:cs_test_a1alice').status, 'completed');
  } finally { await h.close(); }
});

test('confirmation: none -> 428 with nothing sent; a LIVE or unknown key also needs confirmLive', async () => {
  const h = await harness();
  try {
    const bare = await h.call('post', '/stripe/checkout', 'alice', { body: order() });
    assert.equal(bare.code, 428);
    assert.equal(bare.body.guard, 'stripe-confirm');
    assert.equal(h.stripe.seen.length, 0, 'an unconfirmed request sends nothing to Stripe');

    const live = await h.call('post', '/stripe/checkout', 'bob', { body: order({ confirm: true }) });
    assert.equal(live.code, 428);
    assert.deepEqual([live.body.guard, live.body.mode], ['stripe-live-mode', 'live']);
    assert.match(live.body.message, /LIVE/);
    assert.ok(!h.stripe.seen.some((r) => r.method === 'POST'), 'a live key without confirmLive sends no POST');

    const unknown = await h.call('post', '/stripe/refund', 'carol', { body: { chargeId: 'ch_carol1', confirm: true } });
    assert.deepEqual([unknown.code, unknown.body.guard, unknown.body.mode], [428, 'stripe-live-mode', 'unknown']);

    const liveOk = await h.call('post', '/stripe/checkout', 'bob', { body: order({ confirm: true, confirmLive: true }) });
    assert.equal(liveOk.code, 200);
    assert.equal(liveOk.body.session.livemode, true);
    assert.equal(h.pool.rows.get('stripe:cs_live_a1bob').testMode, false);

    const refundBare = await h.call('post', '/stripe/refund', 'alice', { body: { chargeId: 'ch_alice1' } });
    assert.equal(refundBare.code, 428);
    assert.ok(!h.stripe.seen.some((r) => r.url === '/v1/refunds'), 'an unconfirmed refund sends nothing');
    const refund = await h.call('post', '/stripe/refund', 'alice', { body: { chargeId: 'ch_alice1', confirm: true } });
    assert.equal(refund.code, 200, JSON.stringify(refund.body));
    assert.deepEqual(refund.body.refund, { id: 're_1', status: 'succeeded', amountCents: 2500, currency: 'USD', chargeId: 'ch_alice1' });
    const sent = h.stripe.seen.find((r) => r.url === '/v1/refunds');
    assert.deepEqual([sent.who, Object.fromEntries(sent.form)], ['alice', { charge: 'ch_alice1' }], 'a full refund names only the charge');
  } finally { await h.close(); }
});

test('bad input is refused before anything is sent', async () => {
  const h = await harness();
  try {
    for (const body of [order({ confirm: true, amountCents: 10 }), order({ confirm: true, amountCents: 12.5 }), order({ confirm: true, description: '' }),
      order({ confirm: true, currency: 'dollars' }), order({ confirm: true, returnUrl: 'http://evil.example/' }), order({ confirm: true, returnUrl: 'javascript:alert(1)' })]) {
      const res = await h.call('post', '/stripe/checkout', 'alice', { body });
      assert.equal(res.code, 400, JSON.stringify(res.body));
    }
    const res = await h.call('post', '/stripe/refund', 'alice', { body: { chargeId: '../v1/payouts', confirm: true } });
    assert.equal(res.code, 400);
    const session = await h.call('get', '/stripe/checkout/:id', 'alice', { params: { id: 'cs_test_x/../../v1/balance' } });
    assert.equal(session.code, 400);
    assert.equal(h.stripe.seen.length, 0);
    assert.equal((await h.call('get', '/stripe/status', null)).code, 401);
  } finally { await h.close(); }
});

test('each person reaches Stripe with their own key and sees only their own requests', async () => {
  const h = await harness();
  try {
    await h.call('post', '/stripe/checkout', 'alice', { body: order({ confirm: true }) });
    const alicePayments = (await h.call('get', '/stripe/payments', 'alice')).body.payments;
    const bobPayments = (await h.call('get', '/stripe/payments', 'bob')).body.payments;
    assert.deepEqual(alicePayments.map((p) => [p.id, p.livemode]), [['ch_alice1', false]]);
    assert.deepEqual(bobPayments.map((p) => [p.id, p.livemode]), [['ch_bob1', true]]);
    assert.ok(!JSON.stringify(alicePayments).includes('4242') && !JSON.stringify(alicePayments).includes('customer@example.com'), 'no card or customer detail is relayed');
    assert.deepEqual(h.stripe.seen.filter((r) => r.url.startsWith('/v1/charges')).map((r) => r.who), ['alice', 'bob']);
    assert.ok(h.asked.every((sub) => ['alice', 'bob'].includes(sub)), 'transports are asked for the signed-in caller only');
    const peek = await h.call('get', '/stripe/checkout/:id', 'bob', { params: { id: 'cs_test_a1alice' } });
    assert.equal(peek.code, 404, "bob cannot refresh alice's payment request");
    const none = await h.call('get', '/stripe/payments', 'erin');
    assert.deepEqual([none.code, none.body.error], [409, 'not_connected']);
  } finally { await h.close(); }
});

test('no key reaches an answer or a log, even when Stripe echoes one', async () => {
  const h = await harness();
  logs.length = 0;
  try {
    const answers = [];
    answers.push((await h.call('get', '/stripe/status', 'dave')).body);
    answers.push((await h.call('get', '/stripe/payments', 'dave')).body);
    answers.push((await h.call('post', '/stripe/checkout', 'dave', { body: order({ confirm: true, confirmLive: true }) })).body);
    answers.push((await h.call('get', '/providers', 'dave')).body);
    assert.match(answers[1].message, /Stripe rejected the saved key/);
    assertNoKeys(answers);
    assertNoKeys(logs);
  } finally { await h.close(); }
});

test('the scrubber removes every key shape and bearer value', () => {
  const { scrubKeys } = require('../routes/stripe-rail.js');
  const text = scrubKeys(`a ${fakeKey('sk', 'live', 'ABC123')} b ${fakeKey('rk', 'test', 'x***')} c ${fakeKey('pk', 'live', 'Q')} d whsec_test_z Bearer ${fakeKey('sk', 'test', 'zz')} e`);
  assert.doesNotMatch(text, /sk_live_ABC|rk_test_x|pk_live_Q|whsec_test_z|sk_test_zz/);
});
