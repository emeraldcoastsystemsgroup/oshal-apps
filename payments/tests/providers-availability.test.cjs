/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | GET /providers passes a rail's "not configured here" marker through (configured:false + detail), as the native kernel's merchant rails report it, and leaves a configured rail's answer unchanged. Without it the Payments page offered "Connect Square" for a connector the installation does not have.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The merchant rails' rows are unchanged and Stripe now follows them: with no Stripe key it is listed not connected, with the reason in words.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/** Router stand-in recording every mount. */
function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => { routes.push({ method, route, handler: handlers[handlers.length - 1] }); };
  return { routes, get: add('get'), post: add('post'), put: add('put'), delete: add('delete'), use: add('use') };
}

/** Load the compiled route with these merchant rails; every other framework module is a quiet stand-in. */
function loadRoutes(rails) {
  const stubs = {
    express: { Router: fakeRouter },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/features/payments': { listMerchantProviders: () => Object.keys(rails), getMerchantAdapter: (name) => rails[name] || null },
    '@/app/routes/connector-tenancy': { accessibleConnections: async () => [] },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/security/explicit-write-confirmation': { confirmationRequiredPayload: () => ({}), hasExplicitWriteConfirmation: () => false },
  };
  const file = path.resolve(__dirname, '../routes/payments-routes.js');
  delete require.cache[file];
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : load.call(this, request, ...rest);
  };
  try { return require(file); } finally { Module._load = load; }
}

/** Stripe with no key for this caller (the legacy broker has none here). */
const STRIPE_NOT_CONNECTED = { provider: 'stripe', connected: false, testMode: false, mode: 'not_connected', sourceLabel: 'Stripe payment page',
  detail: 'Stripe is not connected. Paste your Stripe key on the Connections page (start with a test key).' };

async function providers(rails) {
  const router = loadRoutes(rails).createPaymentsRoutes({ pool: {}, appPackageDir: path.resolve(__dirname, '..') });
  const handler = router.routes.find((r) => r.method === 'get' && r.route === '/providers').handler;
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ oidc: { user: { sub: 'payments-fixture' } } }, res);
  return res;
}

test('a rail reported not configured carries its reason to the surface', async () => {
  const detail = 'No native merchant connector is configured for this rail; payments cannot be taken until one is.';
  const res = await providers({ square: { sourceLabel: 'Card token', isTestMode: () => true, configured: false, detail } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.providers, [{ provider: 'square', connected: false, testMode: true, sourceLabel: 'Card token', configured: false, detail }, STRIPE_NOT_CONNECTED]);
});

test('a configured rail answers exactly as before', async () => {
  const res = await providers({ paypal: { sourceLabel: 'Email', isTestMode: () => false } });
  assert.deepEqual(res.body.providers, [{ provider: 'paypal', connected: false, testMode: false, sourceLabel: 'Email' }, STRIPE_NOT_CONNECTED]);
});
