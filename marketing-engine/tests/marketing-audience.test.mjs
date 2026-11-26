/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit, route-table parity, and compiled
 *     handler tests for marketing-engine P1 audience store: address normalization and SHA-256
 *     hashing, sign-up consent evidence normalization, segmentation by list/tag/consentState/
 *     channel/purpose/suppressed/q, route-table parity (20 legacy + 11 audience routes),
 *     auth gate, suppression consent revocation & re-confirm refusal, and export-first delete.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.1: update route-table parity to 20 legacy
 *     + 12 audience routes (including POST /audience/contacts/import-csv).
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.2: update route-table parity to 20 legacy
 *     + 12 audience + 5 compliance/template routes.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.3: update route-table parity to 20 legacy
 *     + 12 audience + 5 compliance/template + 7 double opt-in routes.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.5: update route-table parity to 20 legacy
 *     + 12 audience + 5 compliance/template + 7 double opt-in + 7 broadcast/unsubscribe/preference routes.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.6: update route-table parity to 20 legacy
 *     + 12 audience + 5 compliance/template + 7 double opt-in + 7 broadcast/unsubscribe/preference
 *     + 8 sequence/standing-authorization routes.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.7: update route-table parity to include
 *     6 P3 launch plan, grounded retro, and unified calendar routes (65 routes total).
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.8: update route-table parity to include
 *     3 P2 campaign-to-finance-project and reallocation proposal routes (68 routes total).
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | 0.6.9: update route-table parity to include
 *     3 P5 attribution funnel, conversion, and delivery engagement routes (71 routes total).
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | 0.6.10: update route-table parity to include
 *     4 P4 SMS TCPA/CTIA consent, quiet-hours scheduling, queue, and keyword routes (75 routes total).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));

const UUID_CONTACT = '11111111-1111-4111-8111-111111111111';
const UUID_LIST = '22222222-2222-4222-8222-222222222222';
const UUID_CONSENT = '33333333-3333-4333-8333-333333333333';
const UUID_SUPP = '44444444-4444-4444-8444-444444444444';

/** Load a compiled marketing route module with minimal runtime stubs. */
function loadCompiledModule(relPath, extras = {}) {
  const full = join(pkgDir, relPath);
  const src = readFileSync(full, 'utf8');
  const mod = { exports: {} };
  const stubs = {
    express: { Router: () => makeRouter() },
    '@/shared/logger': { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    '@/shared/services/database': {
      runRuntimeSchemaBootstrap: async () => {},
      buildOwnerRlsPolicyStatements: () => [],
    },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (b) => b?.confirm === true,
      confirmationRequiredPayload: (g, a) => ({ error: 'confirmation_required', guard: g, action: a }),
    },
    '@/app/connectors/runtime': { loadConnectorSpec: () => null, resolveConnectorActionCreds: async () => null, runConnectorAction: async () => ({ status: 500, body: { ok: false } }) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ success: false }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    ...extras,
  };
  const cache = new Map();
  const reqStub = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('./')) {
      const target = join(dirname(full), id.endsWith('.js') ? id : `${id}.js`);
      if (!cache.has(target)) cache.set(target, loadCompiledModule(target.slice(pkgDir.length + 1), extras));
      return cache.get(target);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', src)(
    reqStub, mod, mod.exports, full, dirname(full),
  );
  return mod.exports;
}

/** Minimal synthetic Express Router recording method + path + handler. */
function makeRouter() {
  const routes = [];
  const add = (method) => (routePath, ...handlers) => {
    routes.push({ method, path: routePath, handler: handlers[handlers.length - 1] });
  };
  return {
    routes,
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
  };
}

/** Invoke a recorded route handler with a synthetic req/res pair. */
async function callRoute(router, method, routePath, { sub = 'owner-a', params = {}, query = {}, body = {}, headers = {}, ip = '203.0.113.10' } = {}) {
  const entry = router.routes.find((r) => r.method === method && r.path === routePath);
  assert.ok(entry, `route registered: ${method} ${routePath}`);
  const req = { method, path: routePath, params, query, body, headers, ip, oidc: sub ? { user: { sub } } : null };
  const res = {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
    send(payload) { this.body = payload; this.headersSent = true; return this; },
  };
  await entry.handler(req, res);
  return res;
}

test('normalizeEmail and hashAddress are lowercase, trimmed, and deterministic', () => {
  assert.equal(model.normalizeEmail('  Alice.Example+News@Example.COM  '), 'alice.example+news@example.com');
  assert.equal(model.normalizeEmail('not-an-email'), null);
  assert.equal(model.normalizeEmail(''), null);
  assert.equal(model.normalizeEmail(42), null);
  const h1 = model.hashAddress('  Alice@Example.COM ');
  const h2 = model.hashAddress('alice@example.com');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('normalizeConsentEvidence preserves sign-up evidence fields and defaults safely', () => {
  const ev = model.normalizeConsentEvidence({
    formText: 'Yes, send me product updates',
    recordedAt: '2026-11-20T18:30:00Z',
    ip: '198.51.100.7',
    userAgent: 'Mozilla/5.0 TestBrowser',
    utm: { source: 'newsletter', medium: 'email', campaign: 'launch-q4', ignored: 123 },
    tokenHash: 'AA'.repeat(32),
  });
  assert.deepEqual(ev, {
    formText: 'Yes, send me product updates',
    recordedAt: '2026-11-20T18:30:00.000Z',
    ip: '198.51.100.7',
    userAgent: 'Mozilla/5.0 TestBrowser',
    utm: { source: 'newsletter', medium: 'email', campaign: 'launch-q4' },
    tokenHash: 'aa'.repeat(32),
  });
});

test('segmentContacts filters by list, tag, consentState, channel, purpose, suppressed, and q', () => {
  const contacts = [
    {
      contact_id: 'c1', email: 'alice@example.com', email_hash: model.hashAddress('alice@example.com'),
      display_name: 'Alice', tags: ['beta', 'founder'], status: 'active', metadata: {},
      created_at: null, updated_at: null,
      consents: [{ channel: 'email', purpose: 'marketing', status: 'confirmed' }],
      lists: [{ list_id: UUID_LIST, slug: 'launch-list', name: 'Launch List' }],
      suppressions: [], suppressed: false,
    },
    {
      contact_id: 'c2', email: 'bob@example.com', email_hash: model.hashAddress('bob@example.com'),
      display_name: 'Bob', tags: ['beta'], status: 'suppressed', metadata: {},
      created_at: null, updated_at: null,
      consents: [{ channel: 'email', purpose: 'marketing', status: 'revoked' }],
      lists: [{ list_id: UUID_LIST, slug: 'launch-list', name: 'Launch List' }],
      suppressions: [{ channel: 'email', reason: 'unsubscribe' }], suppressed: true,
    },
    {
      contact_id: 'c3', email: 'carol@example.com', email_hash: model.hashAddress('carol@example.com'),
      display_name: 'Carol', tags: ['waitlist'], status: 'active', metadata: {},
      created_at: null, updated_at: null,
      consents: [], lists: [], suppressions: [], suppressed: false,
    },
  ];
  assert.deepEqual(model.segmentContacts(contacts, model.parseAudienceFilters({ list: 'launch-list', consentState: 'confirmed' }).filters).map((c) => c.contact_id), ['c1']);
  assert.deepEqual(model.segmentContacts(contacts, model.parseAudienceFilters({ tag: 'BETA', suppressed: 'true' }).filters).map((c) => c.contact_id), ['c2']);
  assert.deepEqual(model.segmentContacts(contacts, model.parseAudienceFilters({ consentState: 'none' }).filters).map((c) => c.contact_id), ['c3']);
  assert.deepEqual(model.segmentContacts(contacts, model.parseAudienceFilters({ q: 'founder' }).filters).map((c) => c.contact_id), ['c1']);
  assert.equal(model.parseAudienceFilters({ consentState: 'bogus' }).error, 'invalid_consent_state');
  assert.equal(model.parseAudienceFilters({ channel: 'carrier-pigeon' }).error, 'invalid_channel');
  assert.equal(model.parseAudienceFilters({ suppressed: 'maybe' }).error, 'invalid_suppressed_filter');
});

test('route-table parity: marketing-routes preserves all 20 legacy routes and adds all 12 audience, 5 compliance/template, 7 double opt-in, 7 broadcast/unsubscribe/preference, 8 sequence, 6 launch/calendar, 3 P2 budget/reallocation, 3 P5 attribution/engagement, and 4 P4 SMS consent/quiet-hours routes', () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const router = routesMod.createMarketingRoutes({ pool: { query: async () => ({ rows: [], rowCount: 0 }) }, appPackageDir: pkgDir });
  const table = router.routes.map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(table, [
    'GET /',
    'GET /overview',
    'GET /utm',
    'POST /campaigns',
    'POST /campaigns/import',
    'PATCH /campaigns/:id',
    'GET /channels',
    'PUT /channels/:channel',
    'POST /drafts',
    'POST /research',
    'POST /launch-checklist',
    'GET /content',
    'POST /content/:id/publish',
    'GET /scorecard',
    'POST /scorecard/rebuild',
    'GET /experiments',
    'POST /experiments',
    'PATCH /experiments/:id',
    'GET /budget/proposals',
    'POST /budget/proposals/:id/decide',
    'GET /audience/contacts',
    'POST /audience/contacts',
    'POST /audience/contacts/import-csv',
    'GET /audience/contacts/:id/consent-export',
    'DELETE /audience/contacts/:id',
    'GET /audience/lists',
    'POST /audience/lists',
    'POST /audience/lists/:id/members',
    'DELETE /audience/lists/:id/members/:contactId',
    'GET /audience/suppressions',
    'POST /audience/suppressions',
    'DELETE /audience/suppressions/:id',
    'GET /compliance',
    'PUT /compliance',
    'GET /templates',
    'POST /templates/render',
    'POST /content/:id/approve',
    'GET /audience/signup-forms',
    'POST /audience/signup-forms',
    'PATCH /audience/signup-forms/:slug',
    'DELETE /audience/signup-forms/:slug',
    'GET /audience/signup-forms/:slug/snippet',
    'POST /audience/signup-forms/:slug/submit',
    'POST /audience/opt-in/confirm',
    'GET /broadcasts',
    'POST /broadcasts',
    'GET /broadcasts/:id',
    'POST /broadcasts/:id/send',
    'POST /audience/unsubscribe',
    'GET /audience/preferences/:contactId',
    'PUT /audience/preferences/:contactId',
    'GET /sequences',
    'POST /sequences',
    'GET /sequences/:id',
    'POST /sequences/:id/steps',
    'PUT /sequences/:id/authorization',
    'POST /sequences/:id/disarm',
    'POST /sequences/:id/enroll',
    'POST /sequences/:id/tick',
    'GET /launch-plans',
    'POST /launch-plans',
    'GET /launch-plans/:id',
    'PATCH /launch-plans/:id',
    'POST /launch-plans/:id/retro',
    'GET /calendar',
    'POST /campaigns/:id/finance-project',
    'GET /campaigns/:id/budget-summary',
    'POST /campaigns/:id/reallocation-proposals',
    'GET /attribution/funnel',
    'POST /attribution/conversions',
    'POST /deliveries/:deliveryId/event',
    'POST /audience/sms-opt-in',
    'POST /audience/sms/schedule',
    'GET /audience/sms/queue',
    'POST /audience/sms/keyword',
  ]);
});

test('audience routes enforce session auth, validate input, refuse suppressed re-confirm, and export before delete', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const calls = [];
  const evidence = {
    formText: 'I agree to email updates',
    recordedAt: '2026-11-20T12:00:00.000Z',
    ip: '198.51.100.42',
    userAgent: 'TestAgent/1.0',
    utm: { source: 'blog', medium: 'organic', campaign: 'p1' },
    tokenHash: 'a'.repeat(64),
  };
  const emailHash = model.hashAddress('alice@example.com');
  let isSuppressed = false;
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND address_hash = $2')) {
        return { rows: isSuppressed ? [{ suppression_id: UUID_SUPP, channel: 'email', address_hash: emailHash, reason: 'unsubscribe', source: 'manual' }] : [], rowCount: isSuppressed ? 1 : 0 };
      }
      if (sql.includes('FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2')) {
        return { rows: [{ contact_id: UUID_CONTACT, owner_sub: 'owner-a', email: 'alice@example.com', email_hash: emailHash, display_name: 'Alice', tags: ['vip'], status: 'active', metadata: {} }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_consents WHERE contact_id = $1')) {
        return { rows: [{ consent_id: UUID_CONSENT, channel: 'email', purpose: 'marketing', status: 'confirmed', evidence }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_list_members m')) {
        return { rows: [{ list_id: UUID_LIST, slug: 'vip', name: 'VIP', added_at: '2026-11-20T12:00:00Z' }], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_suppressions WHERE address_hash = $1')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });

  // Unauthenticated refused before SQL.
  const unauth = await callRoute(router, 'GET', '/audience/contacts', { sub: null });
  assert.equal(unauth.statusCode, 401);
  assert.equal(calls.length, 0);

  // Invalid email refused.
  const badEmail = await callRoute(router, 'POST', '/audience/contacts', { body: { email: 'nope' } });
  assert.equal(badEmail.statusCode, 400);
  assert.equal(badEmail.body.error, 'invalid_email');

  // Re-confirming a suppressed address is refused 409.
  isSuppressed = true;
  const suppressedConfirm = await callRoute(router, 'POST', '/audience/contacts', {
    body: { email: 'ALICE@example.com', consent: { channel: 'email', status: 'confirmed', evidence } },
  });
  assert.equal(suppressedConfirm.statusCode, 409);
  assert.equal(suppressedConfirm.body.error, 'address_suppressed');

  // Invalid UUID on consent-export -> 404.
  const notFound = await callRoute(router, 'GET', '/audience/contacts/:id/consent-export', { params: { id: 'not-a-uuid' } });
  assert.equal(notFound.statusCode, 404);

  // Delete exports evidence BEFORE deleting rows.
  calls.length = 0;
  const del = await callRoute(router, 'DELETE', '/audience/contacts/:id', { params: { id: UUID_CONTACT } });
  assert.equal(del.statusCode, 200);
  assert.equal(del.body.deleted, true);
  assert.equal(del.body.contactId, UUID_CONTACT);
  assert.deepEqual(del.body.consentExport.consents[0].evidence, evidence);
  const firstDeleteIdx = calls.findIndex((c) => c.sql.startsWith('DELETE FROM'));
  const selectConsentIdx = calls.findIndex((c) => c.sql.includes('FROM oshal_marketing_consents'));
  assert.ok(selectConsentIdx >= 0 && selectConsentIdx < firstDeleteIdx, 'consent export must run before any DELETE');
  assert.ok(calls.some((c) => c.sql.includes('DELETE FROM oshal_marketing_list_members')));
  assert.ok(calls.some((c) => c.sql.includes('DELETE FROM oshal_marketing_consents')));
  assert.ok(calls.some((c) => c.sql.includes('DELETE FROM oshal_marketing_contacts')));
});
