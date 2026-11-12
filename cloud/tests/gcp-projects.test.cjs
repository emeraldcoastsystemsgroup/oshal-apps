/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.0 (T73): GET /api/cloud/gcp/projects with a stand-in for Google (Resource Manager and Cloud Billing), the way the kernel's egress answers: each project's billing status (real billing, linked to a closed account, no billing), the billing accounts with how many projects each funds, pages followed, a deleted project left out, billing Google will not show marked with the step that fixes it, a refused connection said in words, and no answer for a person who is not signed in or off the kernel. The route never sends an Authorization header itself: the kernel places the connection.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.1 (T73): a read the kernel could not make is said in words: no connection answers 409 connect, a connection that could not be renewed 409 reconnect, anything else 502.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/** The compiled route with express stood in, as the kernel's package runtime loads it. */
function load() {
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'express') {
      return { Router: () => { const routes = {}; return { routes, get: (p, f) => { routes[`GET ${p}`] = f; } }; } };
    }
    return original.call(this, request, ...rest);
  };
  try { return require(path.join(__dirname, '..', 'routes', 'gcp-projects.js')); } finally { Module._load = original; }
}
const route = load();

const PROJECTS = [
  { projectId: 'tactical-gate-1', name: 'My First Project', lifecycleState: 'ACTIVE' },
  { projectId: 'gemini-project-2', name: 'Gemini Project', lifecycleState: 'ACTIVE' },
];
const MORE = [
  { projectId: 'vernal-union-3', name: 'My Project 81556', lifecycleState: 'ACTIVE' },
  { projectId: 'old-4', name: 'Deleted one', lifecycleState: 'DELETE_REQUESTED' },
];
const BILLING = {
  'tactical-gate-1': { billingEnabled: true, billingAccountName: 'billingAccounts/01D1D5-OPEN' },
  'gemini-project-2': { billingEnabled: false, billingAccountName: 'billingAccounts/011657-CLOSED' },
  'vernal-union-3': { billingEnabled: false, billingAccountName: '' },
};
const ACCOUNTS = [
  { name: 'billingAccounts/01D1D5-OPEN', displayName: 'My Billing Account', open: true },
  { name: 'billingAccounts/011657-CLOSED', displayName: 'My Billing Account 1', open: false },
  { name: 'billingAccounts/01BD54-SPARE', displayName: 'My Billing Account 2', open: true },
];

/** A stand-in for Google; `over` answers a URL differently; every request is recorded with its headers. */
function google(over = () => null) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    const reply = over(url) || (() => {
      if (url.startsWith('https://cloudresourcemanager.googleapis.com/v1/projects?')) {
        return url.includes('pageToken=p2') ? { body: { projects: MORE } } : { body: { projects: PROJECTS, nextPageToken: 'p2' } };
      }
      const billing = url.match(/\/v1\/projects\/([^/]+)\/billingInfo$/);
      if (billing) return { body: BILLING[decodeURIComponent(billing[1])] };
      if (url.startsWith('https://cloudbilling.googleapis.com/v1/billingAccounts?')) return { body: { billingAccounts: ACCOUNTS } };
      return { status: 404, body: {} };
    })();
    const status = reply.status || 200;
    return { status, ok: status >= 200 && status < 300, json: async () => reply.body || {} };
  };
  return { fetchImpl, calls };
}

test('each project gets its billing status, read with the connection the kernel places', async () => {
  const { fetchImpl, calls } = google();
  const out = await route.readGcp(fetchImpl);
  assert.deepEqual(out.projects.map((p) => [p.name, p.status, p.billingAccountName, p.billingAccountOpen]), [
    ['My First Project', 'real billing', 'My Billing Account', true],
    ['Gemini Project', 'linked to a closed billing account', 'My Billing Account 1', false],
    ['My Project 81556', 'no billing', null, null],
  ], 'the second page is read, and a project being deleted is left out');
  assert.deepEqual(out.accounts.map((a) => [a.name, a.open, a.projects]), [
    ['My Billing Account', true, 1], ['My Billing Account 1', false, 1], ['My Billing Account 2', true, 0],
  ]);
  assert.deepEqual(out.summary, { projects: 3, realBilling: 1, closedAccount: 1, noBilling: 1 });
  assert.equal(out.billingVisible, true);
  assert.ok(calls.every((c) => !('authorization' in c.headers) && !('Authorization' in c.headers)), 'the route never sends a credential itself');
  assert.ok(calls.every((c) => /^https:\/\/(cloudresourcemanager|cloudbilling)\.googleapis\.com\//.test(c.url)), 'only the two hosts the connector names');
});

test('billing Google will not show is marked with the step that fixes it, not a failure', async () => {
  const { fetchImpl } = google((url) => (url.includes('cloudbilling') ? { status: 403, body: { error: { message: 'insufficient authentication scopes' } } } : null));
  const out = await route.readGcp(fetchImpl);
  assert.equal(out.billingVisible, false);
  assert.ok(out.projects.every((p) => p.status === 'billing not visible: reconnect Google Cloud to let this app read billing'), JSON.stringify(out.projects));
  assert.deepEqual(out.accounts, []);
});

/** Call the mounted route as the kernel would. */
async function call(fetchImpl, { signedIn = true, kernel = true } = {}) {
  const before = process.env.OSHAL_EGRESS;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  try {
    const router = route.createGcpProjectsRoutes({}, fetchImpl);
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
    const req = { oidc: signedIn ? { user: { sub: 'person-a' }, isAuthenticated: () => true } : undefined };
    await router.routes['GET /'](req, res);
    return res;
  } finally {
    if (before === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = before;
  }
}

test('the route answers the person, refuses a stranger, and says a refused connection in words', async () => {
  const ok = await call(google().fetchImpl);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  assert.equal(ok.body.summary.projects, 3);
  assert.equal((await call(google().fetchImpl, { signedIn: false })).statusCode, 401);
  const off = await call(google().fetchImpl, { kernel: false });
  assert.deepEqual([off.statusCode, off.body.error], [503, 'not_on_kernel']);
  const refused = await call(google((url) => (url.includes('cloudresourcemanager') ? { status: 401, body: {} } : null)).fetchImpl);
  assert.deepEqual([refused.statusCode, refused.body.error], [409, 'reconnect']);
  assert.match(refused.body.message, /Reconnect Google Cloud on the Cloud Accounts screen/);
  const broken = await call(google((url) => (url.includes('cloudresourcemanager') ? { status: 500, body: {} } : null)).fetchImpl);
  assert.deepEqual([broken.statusCode, broken.body.error], [502, 'provider_error']);
});

test('1.3.1: no connection, or one that could not be renewed, is said with the button that fixes it', async () => {
  const throwing = (message) => async () => { throw new Error(message); };
  const none = await call(throwing('unavailable: gcp is not connected: connect your own gcp account on Utilities'));
  assert.deepEqual([none.statusCode, none.body.error], [409, 'connect']);
  assert.match(none.body.message, /Press Connect Google Cloud on the Cloud Accounts screen/);
  const lapsed = await call(throwing('unavailable: the saved gcp connection expired and could not be renewed (invalid_grant); reconnect it on Utilities'));
  assert.deepEqual([lapsed.statusCode, lapsed.body.error], [409, 'reconnect']);
  assert.match(lapsed.body.message, /Press Reconnect Google Cloud on the Cloud Accounts screen/);
  const other = await call(throwing('socket hang up'));
  assert.deepEqual([other.statusCode, other.body.error, other.body.message], [502, 'provider_error', 'Google Cloud could not be read right now.']);
});
