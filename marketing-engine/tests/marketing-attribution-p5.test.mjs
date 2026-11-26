/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit and compiled-handler tests for
 *     marketing-engine 0.6.9 P5 attribution and per-campaign engagement: extractEventAttribution
 *     (direct fields, nested meta/utm, and URL query strings), marketing-ops-routes ingest
 *     writing campaign_slug and medium into oshal_marketing_events INSERTs, sign-up form UTM
 *     first-touch signup conversion capture and immutable first-touch inheritance on subsequent
 *     purchase conversions, per-campaign engagement rollup with explicit NO DATA when nothing
 *     was sent, delivery event auto-suppression on bounce/complaint/unsubscribe, and two-owner
 *     404 isolation across /attribution/funnel, /attribution/conversions, and
 *     /deliveries/:deliveryId/event.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const attrModel = require(join(pkgDir, 'routes', 'marketing-attribution-model.js'));
const audModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));

const UUID_CONTACT_A = '11111111-1111-4111-8111-111111111111';
const UUID_CAMP_ALPHA = '22222222-2222-4222-8222-222222222222';
const UUID_CAMP_BETA = '33333333-3333-4333-8333-333333333333';
const UUID_MSG_A = '44444444-4444-4444-8444-444444444444';
const UUID_DELIVERY_1 = '55555555-5555-4555-8555-555555555555';
const UUID_DELIVERY_2 = '66666666-6666-4666-8666-666666666666';

/** Minimal synthetic Express Router recording method + path + handler. */
function makeRouter() {
  const routes = [];
  const add = (method) => (routePath, ...handlers) => {
    routes.push({ method, path: routePath, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

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
    '@/shared/services/database/request-identity': {
      runWithSystemIdentity: async (fn) => fn(),
    },
    '@/shared/security/explicit-write-confirmation': {
      hasExplicitWriteConfirmation: (b) => b?.confirm === true,
      confirmationRequiredPayload: (g, a) => ({ error: 'confirmation_required', guard: g, action: a }),
    },
    '@/app/connectors/runtime': {
      loadConnectorSpec: () => ({ name: 'gsc' }),
      invokeSpecResource: async () => ({ status: 200, body: { ok: false } }),
      resolveConnectorActionCreds: async () => null,
      runConnectorAction: async () => ({ status: 500, body: { ok: false } }),
    },
    '@/app/connectors/runtime/spec-tools': { resolveConnectorSpecCreds: async () => null },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ success: false }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/features/notifications': { notifyOperator: async () => ({ delivered: false, skipped: true }) },
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

test('extractEventAttribution parses direct fields, nested utm/meta, and URL queries, returning null when absent', () => {
  assert.deepEqual(
    attrModel.extractEventAttribution({ utm_campaign: 'Launch-Alpha', utm_medium: 'Email', utm_source: 'Newsletter' }),
    { campaignSlug: 'launch-alpha', medium: 'email', source: 'newsletter' },
  );
  assert.deepEqual(
    attrModel.extractEventAttribution({ url: 'https://oshal.ai/start?ref=1&utm_campaign=Spring_Beta&utm_medium=Organic&utm_source=Google' }),
    { campaignSlug: 'spring_beta', medium: 'organic', source: 'google' },
  );
  assert.deepEqual(
    attrModel.extractEventAttribution({ meta: { keys: ['2026-11-23', 'https://oshal.ai/?utm_campaign=gsc-hit&utm_medium=cpc'] } }),
    { campaignSlug: 'gsc-hit', medium: 'cpc', source: null },
  );
  assert.deepEqual(
    attrModel.extractEventAttribution({ url: 'https://oshal.ai/docs', meta: {} }),
    { campaignSlug: null, medium: null, source: null },
  );
  assert.deepEqual(attrModel.extractEventAttribution(null), { campaignSlug: null, medium: null, source: null });
});

test('marketing-ops-routes ingest writes campaign_slug and medium on oshal_marketing_events INSERTs (and NULL when unattributed)', async () => {
  const now = new Date();
  const day = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10);
  const d3 = day(3);
  const d2 = day(2);
  const inserts = [];

  const opsMod = loadCompiledModule('routes/marketing-ops-routes.js', {
    '@/app/connectors/runtime': {
      loadConnectorSpec: (p) => ({ name: p.includes('google-search-console') ? 'gsc' : 'posthog' }),
      invokeSpecResource: async (_spec, _creds, resource) => {
        if (resource === 'sites') {
          return { status: 200, body: { ok: true, data: { siteEntry: [{ siteUrl: 'https://oshal.ai/', permissionLevel: 'siteOwner' }] } } };
        }
        if (resource === 'searchanalytics') {
          return {
            status: 200,
            body: {
              ok: true,
              data: {
                rows: [
                  { keys: [d3, 'https://oshal.ai/go?utm_campaign=launch-alpha&utm_medium=organic'], clicks: 42, impressions: 300 },
                  { keys: [d2, 'https://oshal.ai/plain-page'], clicks: 9, impressions: 120 },
                ],
              },
            },
          };
        }
        return { status: 200, body: { ok: false } };
      },
    },
    '@/app/connectors/runtime/spec-tools': {
      resolveConnectorSpecCreds: async (spec) => (spec.name === 'gsc' ? { token: 'fake-gsc' } : null),
    },
  });

  const pool = {
    query: async (sql, params = []) => {
      if (sql.includes('SELECT DISTINCT user_sub FROM oshal_marketing_campaigns')) {
        return { rows: [{ user_sub: 'owner-a' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_events')) {
        inserts.push({ sql, params });
      }
      return { rows: [], rowCount: 0 };
    },
  };

  await opsMod.runMarketingDailyIngest({ pool });
  const attributedClick = inserts.find((r) => r.params[5] === 'clicks' && r.params[3] === 'launch-alpha');
  const unattributedClick = inserts.find((r) => r.params[5] === 'clicks' && r.params[3] === null);
  assert.ok(attributedClick, 'GSC UTM-tagged page writes campaign_slug into oshal_marketing_events');
  assert.match(attributedClick.sql, /campaign_slug,\s*medium/);
  assert.equal(attributedClick.params[3], 'launch-alpha');
  assert.equal(attributedClick.params[4], 'organic');
  assert.equal(attributedClick.params[6], 42);
  assert.ok(unattributedClick, 'unattributed page preserves NULL campaign_slug and medium');
  assert.equal(unattributedClick.params[4], null);
  assert.equal(unattributedClick.params[6], 9);
});

test('sign-up with UTM records first-touch signup conversion and subsequent purchase inherits first-touch campaign_slug', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const state = {
    forms: [],
    contacts: [],
    consents: [],
    tokens: [],
    conversions: [],
    campaigns: [
      { campaign_id: UUID_CAMP_ALPHA, user_sub: 'owner-a', slug: 'launch-alpha', name: 'Launch Alpha', status: 'active' },
      { campaign_id: UUID_CAMP_BETA, user_sub: 'owner-a', slug: 'quiet-beta', name: 'Quiet Beta', status: 'active' },
    ],
    events: [
      { user_sub: 'owner-a', source: 'gsc', campaign_slug: 'launch-alpha', medium: 'organic', event: 'clicks', value: 25 },
    ],
    deliveries: [],
  };

  const pool = {
    query: async (sql, params = []) => {
      if (sql.includes('INSERT INTO oshal_marketing_signup_forms')) {
        const row = {
          form_id: '77777777-7777-4777-8777-777777777777', owner_sub: params[0], slug: params[1], name: params[2],
          consent_text: params[3], list_id: params[4], honeypot_field: params[5], signing_secret: params[6],
          rate_limit_per_ip_hour: params[7], rate_limit_per_form_hour: params[8], token_ttl_minutes: params[9],
          confirmation_base_url: params[10], enabled: params[11],
        };
        state.forms.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_signup_forms WHERE owner_sub = $1 AND slug = $2')) {
        return { rows: state.forms.filter((f) => f.owner_sub === params[0] && f.slug === params[1]), rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_suppressions')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO oshal_marketing_contacts')) {
        const row = { contact_id: UUID_CONTACT_A, owner_sub: params[0], email: params[1], email_hash: params[2], display_name: params[3], status: 'active' };
        state.contacts.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2')) {
        return { rows: state.contacts.filter((c) => c.contact_id === params[0] && c.owner_sub === params[1]), rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2')) {
        return { rows: state.contacts.filter((c) => c.owner_sub === params[0] && c.email_hash === params[1]), rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_consents')) {
        state.consents.push({
          consent_id: params[0], owner_sub: params[1], contact_id: params[2], channel: 'email', status: 'pending',
          evidence: JSON.parse(params[3]), created_at: '2026-11-25T10:00:00.000Z',
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_consents') && sql.includes('ORDER BY created_at ASC')) {
        return { rows: state.consents.filter((c) => c.owner_sub === params[0] && c.contact_id === params[1]), rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_optin_tokens')) {
        state.tokens.push({ token_id: params[0], owner_sub: params[1], form_id: params[2], contact_id: params[3], consent_id: params[4], token_hash: params[5] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT conversion_id FROM oshal_marketing_conversions')) {
        const hit = state.conversions.filter((c) => c.owner_sub === params[0] && c.contact_id === params[1] && c.kind === 'signup');
        return { rows: hit, rowCount: hit.length };
      }
      if (sql.includes('INSERT INTO oshal_marketing_conversions')) {
        const isSignup = sql.includes("'signup'");
        const row = isSignup
          ? {
            conversion_id: `conv-${state.conversions.length + 1}`, owner_sub: params[0], contact_id: params[1],
            campaign_slug: params[2], medium: params[3], source: params[4], kind: 'signup', amount_cents: 0,
            reference_id: params[5], utm: JSON.parse(params[6]), occurred_at: params[7],
          }
          : {
            conversion_id: `conv-${state.conversions.length + 1}`, owner_sub: params[0], contact_id: params[1],
            campaign_slug: params[2], medium: params[3], source: params[4], kind: params[5], amount_cents: params[6],
            reference_id: params[7], utm: JSON.parse(params[8]), occurred_at: params[9],
          };
        state.conversions.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_campaigns WHERE user_sub = $1')) {
        return { rows: state.campaigns.filter((c) => c.user_sub === params[0]), rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_events WHERE user_sub = $1')) {
        return { rows: state.events.filter((e) => e.user_sub === params[0]), rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_conversions') && sql.includes('ORDER BY occurred_at DESC')) {
        return { rows: state.conversions.filter((c) => c.owner_sub === params[0]), rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_deliveries d')) {
        return { rows: state.deliveries.filter((d) => d.owner_sub === params[0]), rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });
  const createdForm = await callRoute(router, 'POST', '/audience/signup-forms', {
    body: { slug: 'waitlist-alpha', name: 'Alpha Waitlist', consentText: 'Yes, email me launch updates.' },
  });
  assert.equal(createdForm.statusCode, 201);

  const submitted = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'waitlist-alpha' },
    body: {
      email: 'buyer@example.com',
      displayName: 'Buyer One',
      utm_campaign: 'launch-alpha',
      utm_medium: 'email',
      utm_source: 'newsletter',
      returnPreviewLink: true,
    },
  });
  assert.equal(submitted.statusCode, 200);
  assert.equal(state.conversions.length, 1);
  assert.equal(state.conversions[0].kind, 'signup');
  assert.equal(state.conversions[0].campaign_slug, 'launch-alpha');
  assert.equal(state.conversions[0].medium, 'email');

  // Subsequent purchase without explicit campaignSlug inherits immutable first-touch launch-alpha!
  const purchase = await callRoute(router, 'POST', '/attribution/conversions', {
    body: { kind: 'purchase', contactId: UUID_CONTACT_A, amountCents: 4900, referenceId: 'order-49' },
  });
  assert.equal(purchase.statusCode, 201);
  assert.equal(purchase.body.firstTouchApplied, true);
  assert.equal(purchase.body.conversion.campaign_slug, 'launch-alpha');
  assert.equal(purchase.body.conversion.medium, 'email');
  assert.equal(purchase.body.conversion.amount_cents, 4900);

  // Funnel shows launch-alpha with visits + signups + purchases + revenue, and quiet-beta with NO DATA!
  const funnelA = await callRoute(router, 'GET', '/attribution/funnel', { sub: 'owner-a' });
  assert.equal(funnelA.statusCode, 200);
  assert.equal(funnelA.body.opensNote, 'Opens are omitted as unreliable');
  const alpha = funnelA.body.campaigns.find((c) => c.campaignSlug === 'launch-alpha');
  const beta = funnelA.body.campaigns.find((c) => c.campaignSlug === 'quiet-beta');
  assert.equal(alpha.traffic.status, 'ok');
  assert.equal(alpha.traffic.visits, 25);
  assert.equal(alpha.conversions.signups, 1);
  assert.equal(alpha.conversions.purchases, 1);
  assert.equal(alpha.conversions.revenueCents, 4900);
  assert.equal(alpha.engagement.status, 'NO DATA');
  assert.equal(beta.traffic.status, 'NO DATA');
  assert.equal(beta.engagement.status, 'NO DATA');

  // Two-owner isolation: Owner B sees 0 campaigns & gets 404 on Owner A's contactId.
  const funnelB = await callRoute(router, 'GET', '/attribution/funnel', { sub: 'owner-b' });
  assert.equal(funnelB.statusCode, 200);
  assert.equal(funnelB.body.campaigns.length, 0);
  assert.equal(funnelB.body.totals.purchases, 0);

  const foreignConv = await callRoute(router, 'POST', '/attribution/conversions', {
    sub: 'owner-b',
    body: { kind: 'purchase', contactId: UUID_CONTACT_A, amountCents: 1000 },
  });
  assert.equal(foreignConv.statusCode, 404);
  assert.equal(foreignConv.body.error, 'contact_not_found');
});

test('per-campaign delivery engagement counts clicked/bounced/complained/unsubscribed, auto-suppresses, reports NO DATA on quiet campaign, and enforces 404 isolation', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const emailHash1 = audModel.hashAddress('reader1@example.com');
  const emailHash2 = audModel.hashAddress('reader2@example.com');
  const deliveries = [
    {
      delivery_id: UUID_DELIVERY_1, owner_sub: 'owner-a', message_id: UUID_MSG_A, campaign_id: UUID_CAMP_ALPHA,
      campaign_slug: 'launch-alpha', contact_id: UUID_CONTACT_A, email_hash: emailHash1, status: 'sent',
      clicked_at: null, bounced_at: null, complained_at: null, unsubscribed_at: null,
    },
    {
      delivery_id: UUID_DELIVERY_2, owner_sub: 'owner-a', message_id: UUID_MSG_A, campaign_id: UUID_CAMP_ALPHA,
      campaign_slug: 'launch-alpha', contact_id: null, email_hash: emailHash2, status: 'sent',
      clicked_at: null, bounced_at: null, complained_at: null, unsubscribed_at: null,
    },
  ];
  const suppressions = [];
  const revokedContacts = [];

  const pool = {
    query: async (sql, params = []) => {
      if (sql.includes('FROM oshal_marketing_deliveries') && sql.includes('WHERE delivery_id = $1 AND owner_sub = $2')) {
        return { rows: deliveries.filter((d) => d.delivery_id === params[0] && d.owner_sub === params[1]), rowCount: 1 };
      }
      if (sql.includes('UPDATE oshal_marketing_deliveries')) {
        const d = deliveries.find((row) => row.delivery_id === params[0] && row.owner_sub === params[1]);
        if (!d) return { rows: [], rowCount: 0 };
        if (sql.includes('SET clicked_at')) d.clicked_at = d.clicked_at ?? params[2];
        if (sql.includes('SET bounced_at')) d.bounced_at = d.bounced_at ?? params[2];
        if (sql.includes('SET complained_at')) d.complained_at = d.complained_at ?? params[2];
        if (sql.includes('SET unsubscribed_at')) d.unsubscribed_at = d.unsubscribed_at ?? params[2];
        return { rows: [d], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_suppressions')) {
        const s = { owner_sub: params[0], channel: 'email', address_hash: params[1], reason: params[2], source: 'delivery_event' };
        suppressions.push(s);
        return { rows: [s], rowCount: 1 };
      }
      if (sql.includes('UPDATE oshal_marketing_consents')) {
        revokedContacts.push(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_campaigns WHERE user_sub = $1')) {
        return {
          rows: [
            { campaign_id: UUID_CAMP_ALPHA, slug: 'launch-alpha', name: 'Launch Alpha', status: 'active' },
            { campaign_id: UUID_CAMP_BETA, slug: 'quiet-beta', name: 'Quiet Beta', status: 'active' },
          ].filter(() => params[0] === 'owner-a'),
          rowCount: 2,
        };
      }
      if (sql.includes('FROM oshal_marketing_deliveries d')) {
        return { rows: deliveries.filter((d) => d.owner_sub === params[0]), rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });

  // Invalid event rejected 400 (including 'opened' since opens are omitted as unreliable).
  const badEv = await callRoute(router, 'POST', '/deliveries/:deliveryId/event', {
    params: { deliveryId: UUID_DELIVERY_1 },
    body: { event: 'opened' },
  });
  assert.equal(badEv.statusCode, 400);
  assert.equal(badEv.body.error, 'invalid_delivery_event');

  // Owner B gets 404 on Owner A's delivery.
  const foreign = await callRoute(router, 'POST', '/deliveries/:deliveryId/event', {
    sub: 'owner-b',
    params: { deliveryId: UUID_DELIVERY_1 },
    body: { event: 'clicked' },
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.body.error, 'delivery_not_found');

  // Click does NOT suppress; bounce + complaint + unsubscribe DO suppress!
  const clicked = await callRoute(router, 'POST', '/deliveries/:deliveryId/event', {
    params: { deliveryId: UUID_DELIVERY_1 },
    body: { event: 'clicked' },
  });
  assert.equal(clicked.statusCode, 200);
  assert.equal(clicked.body.suppressed, false);
  assert.equal(suppressions.length, 0);

  const unsub = await callRoute(router, 'POST', '/deliveries/:deliveryId/event', {
    params: { deliveryId: UUID_DELIVERY_1 },
    body: { event: 'unsubscribed' },
  });
  assert.equal(unsub.statusCode, 200);
  assert.equal(unsub.body.suppressed, true);
  assert.ok(revokedContacts.includes(UUID_CONTACT_A));

  const bounced = await callRoute(router, 'POST', '/deliveries/:deliveryId/event', {
    params: { deliveryId: UUID_DELIVERY_2 },
    body: { event: 'bounced', reason: 'hard_bounce_550' },
  });
  assert.equal(bounced.statusCode, 200);
  assert.equal(bounced.body.suppressed, true);

  const complained = await callRoute(router, 'POST', '/deliveries/:deliveryId/event', {
    params: { deliveryId: UUID_DELIVERY_2 },
    body: { event: 'complained' },
  });
  assert.equal(complained.statusCode, 200);
  assert.equal(complained.body.suppressed, true);
  assert.equal(suppressions.length, 3);
  assert.equal(suppressions[1].reason, 'hard_bounce_550');

  // Verify funnel counts exact engagement for launch-alpha and NO DATA for quiet-beta!
  const funnel = await callRoute(router, 'GET', '/attribution/funnel');
  assert.equal(funnel.statusCode, 200);
  const alpha = funnel.body.campaigns.find((c) => c.campaignSlug === 'launch-alpha');
  const beta = funnel.body.campaigns.find((c) => c.campaignSlug === 'quiet-beta');
  assert.equal(alpha.engagement.status, 'ok');
  assert.equal(alpha.engagement.delivered, 2);
  assert.equal(alpha.engagement.clicked, 1);
  assert.equal(alpha.engagement.unsubscribed, 1);
  assert.equal(alpha.engagement.bounced, 1);
  assert.equal(alpha.engagement.complained, 1);
  assert.equal(alpha.engagement.opensNote, 'Opens are omitted as unreliable');
  assert.equal(beta.engagement.status, 'NO DATA');
  assert.equal(beta.engagement.delivered, 0);
});
