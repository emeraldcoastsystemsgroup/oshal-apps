/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Comprehensive unit and compiled-route tests
 *     for marketing-engine 0.6.3 P1 double opt-in sign-up forms: form validation, HMAC-SHA256
 *     token signing and constant-time verification (valid, tampered, wrong secret, expired),
 *     bounded sliding-window per-IP and per-form rate limiter with 1-hour reset, HTML-escaped
 *     static-site embed snippet, silent honeypot zero-write short-circuit, suppression immunity,
 *     pending -> confirmed transition, single-use replay refusal (409), forged (400) and expired
 *     (410) refusals, and two-owner isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const optinModel = require(join(pkgDir, 'routes', 'marketing-optin-model.js'));
const audienceModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));

const UUID_TOKEN = '11111111-1111-4111-8111-111111111111';
const UUID_CONTACT = '22222222-2222-4222-8222-222222222222';
const UUID_CONSENT = '33333333-3333-4333-8333-333333333333';
const UUID_FORM = '44444444-4444-4444-8444-444444444444';
const UUID_LIST = '55555555-5555-4555-8555-555555555555';
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

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
    '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
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

/** Create an in-memory relational store implementing the SQL queries used by marketing-optin.js. */
function makeInMemoryOptInPool() {
  const forms = new Map();
  const contacts = new Map();
  const consents = new Map();
  const tokens = new Map();
  const suppressions = new Map();
  const lists = new Map([[`owner-a:${UUID_LIST}`, { list_id: UUID_LIST, owner_sub: 'owner-a' }]]);
  const memberships = [];

  const pool = {
    forms, contacts, consents, tokens, suppressions, memberships,
    query: async (sql, params = []) => {
      if (sql.includes('SELECT list_id FROM oshal_marketing_lists')) {
        const key = `${params[1]}:${params[0]}`;
        return { rows: lists.has(key) ? [lists.get(key)] : [], rowCount: lists.has(key) ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_signup_forms')) {
        const key = `${params[0]}:${params[1]}`;
        if (forms.has(key)) { const e = new Error('dup'); e.code = '23505'; throw e; }
        const row = {
          form_id: UUID_FORM, owner_sub: params[0], slug: params[1], name: params[2],
          consent_text: params[3], list_id: params[4], honeypot_field: params[5],
          signing_secret: params[6], rate_limit_per_ip_hour: params[7],
          rate_limit_per_form_hour: params[8], token_ttl_minutes: params[9],
          confirmation_base_url: params[10], enabled: params[11],
          created_at: '2026-11-25T18:00:00.000Z', updated_at: '2026-11-25T18:00:00.000Z',
        };
        forms.set(key, row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM oshal_marketing_signup_forms f')) {
        const owner = params[0];
        const rows = [...forms.values()].filter((f) => f.owner_sub === owner).map((f) => {
          const formTokens = [...tokens.values()].filter((t) => t.form_id === f.form_id && t.owner_sub === owner);
          const pending_count = formTokens.filter((t) => consents.get(t.consent_id)?.status === 'pending').length;
          const confirmed_count = formTokens.filter((t) => consents.get(t.consent_id)?.status === 'confirmed').length;
          return { ...f, pending_count, confirmed_count };
        });
        return { rows, rowCount: rows.length };
      }
      if (sql.includes('FROM oshal_marketing_signup_forms') && sql.includes('WHERE owner_sub = $1 AND slug = $2')) {
        const row = forms.get(`${params[0]}:${params[1]}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('UPDATE oshal_marketing_signup_forms SET')) {
        const owner = params[params.length - 2];
        const slug = params[params.length - 1];
        const row = forms.get(`${owner}:${slug}`);
        if (!row) return { rows: [], rowCount: 0 };
        if (sql.includes('name = $')) row.name = params[0];
        if (sql.includes('enabled = $')) row.enabled = params[params.length - 3];
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM oshal_marketing_signup_forms')) {
        const ok = forms.delete(`${params[0]}:${params[1]}`);
        return { rows: [], rowCount: ok ? 1 : 0 };
      }
      if (sql.includes('FROM oshal_marketing_suppressions WHERE owner_sub = $1')) {
        const row = suppressions.get(`${params[0]}:${params[1]}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2')) {
        const row = [...contacts.values()].find((c) => c.owner_sub === params[0] && c.email_hash === params[1]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2')) {
        const row = contacts.get(params[0]);
        return { rows: row && row.owner_sub === params[1] ? [row] : [], rowCount: row && row.owner_sub === params[1] ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_contacts')) {
        let row = [...contacts.values()].find((c) => c.owner_sub === params[0] && c.email_hash === params[2]);
        if (!row) {
          row = { contact_id: `00000000-0000-4000-8000-${String(contacts.size + 1).padStart(12, '0')}`, owner_sub: params[0], email: params[1], email_hash: params[2], display_name: params[3], status: 'active' };
          contacts.set(row.contact_id, row);
        } else if (params[3]) {
          row.display_name = params[3];
        }
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_list_members')) {
        memberships.push({ owner_sub: params[0], list_id: params[1], contact_id: params[2] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_consents')) {
        const row = { consent_id: params[0], owner_sub: params[1], contact_id: params[2], channel: 'email', purpose: 'marketing', status: 'pending', evidence: JSON.parse(params[3]) };
        consents.set(row.consent_id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO oshal_marketing_optin_tokens')) {
        const row = { token_id: params[0], owner_sub: params[1], form_id: params[2], contact_id: params[3], consent_id: params[4], token_hash: params[5], expires_at: params[6], consumed_at: null };
        tokens.set(row.token_id, row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('SELECT token_id, consumed_at FROM oshal_marketing_optin_tokens')) {
        const row = tokens.get(params[0]);
        const match = row && row.owner_sub === params[1] && row.token_hash === params[2];
        return { rows: match ? [row] : [], rowCount: match ? 1 : 0 };
      }
      if (sql.includes('UPDATE oshal_marketing_optin_tokens')) {
        const row = tokens.get(params[0]);
        if (!row || row.owner_sub !== params[1] || row.token_hash !== params[2] || row.consumed_at || Date.parse(row.expires_at) <= Date.parse(params[3])) {
          return { rows: [], rowCount: 0 };
        }
        row.consumed_at = params[3];
        return { rows: [{ token_id: row.token_id }], rowCount: 1 };
      }
      if (sql.includes('SELECT consumed_at FROM oshal_marketing_optin_tokens')) {
        const row = tokens.get(params[0]);
        return { rows: row && row.owner_sub === params[1] ? [row] : [], rowCount: row && row.owner_sub === params[1] ? 1 : 0 };
      }
      if (sql.includes('UPDATE oshal_marketing_consents')) {
        const row = consents.get(params[0]);
        if (!row || row.owner_sub !== params[1] || row.contact_id !== params[2] || row.status !== 'pending') return { rows: [], rowCount: 0 };
        row.status = 'confirmed';
        row.evidence = { ...row.evidence, ...JSON.parse(params[3]) };
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

test('HMAC-SHA256 confirmation tokens verify valid, refuse tampered/wrong-secret (token_forged), and refuse expired (token_expired)', () => {
  const now = Date.parse('2026-11-25T18:00:00.000Z');
  const minted = optinModel.mintConfirmationToken({
    tokenId: UUID_TOKEN,
    ownerSub: 'owner-a',
    formSlug: 'launch-waitlist',
    contactId: UUID_CONTACT,
    consentId: UUID_CONSENT,
    emailHash: audienceModel.hashAddress('alice@example.com'),
    expiresAtMs: now + 60_000,
  }, SECRET_A);

  assert.match(minted.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(minted.token, minted.tokenHash);

  const ok = optinModel.verifyConfirmationToken(minted.token, SECRET_A, now + 10_000);
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.tokenId, UUID_TOKEN);
  assert.equal(ok.tokenHash, minted.tokenHash);

  // Tampered payload refused.
  const [p, s] = minted.token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...ok.payload, formSlug: 'evil-form' }), 'utf8').toString('base64url');
  assert.deepEqual(optinModel.verifyConfirmationToken(`${tamperedPayload}.${s}`, SECRET_A, now), { ok: false, error: 'token_forged' });

  // Tampered signature refused.
  const badSig = `${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.deepEqual(optinModel.verifyConfirmationToken(`${p}.${badSig}`, SECRET_A, now), { ok: false, error: 'token_forged' });

  // Wrong form secret refused.
  assert.deepEqual(optinModel.verifyConfirmationToken(minted.token, SECRET_B, now), { ok: false, error: 'token_forged' });

  // Expired token refused.
  const expired = optinModel.verifyConfirmationToken(minted.token, SECRET_A, now + 60_001);
  assert.equal(expired.ok, false);
  assert.equal(expired.error, 'token_expired');
});

test('SlidingWindowRateLimiter enforces per-IP cap, per-form cap, and resets after 1 hour', () => {
  const limiter = new optinModel.SlidingWindowRateLimiter({ windowMs: 3600_000, maxEntries: 128 });
  const t0 = 1_700_000_000_000;

  // Per-IP cap of 2.
  assert.equal(limiter.checkAndConsume({ ipKey: '198.51.100.1', formKey: 'f1', ipLimit: 2, formLimit: 3, nowMs: t0 }).allowed, true);
  assert.equal(limiter.checkAndConsume({ ipKey: '198.51.100.1', formKey: 'f1', ipLimit: 2, formLimit: 3, nowMs: t0 + 1000 }).allowed, true);
  const ipBlocked = limiter.checkAndConsume({ ipKey: '198.51.100.1', formKey: 'f1', ipLimit: 2, formLimit: 3, nowMs: t0 + 2000 });
  assert.equal(ipBlocked.allowed, false);
  assert.equal(ipBlocked.code, 'rate_limit_ip_exceeded');

  // Second IP consumes the 3rd form slot; 3rd IP trips per-form cap.
  assert.equal(limiter.checkAndConsume({ ipKey: '198.51.100.2', formKey: 'f1', ipLimit: 2, formLimit: 3, nowMs: t0 + 3000 }).allowed, true);
  const formBlocked = limiter.checkAndConsume({ ipKey: '198.51.100.3', formKey: 'f1', ipLimit: 2, formLimit: 3, nowMs: t0 + 4000 });
  assert.equal(formBlocked.allowed, false);
  assert.equal(formBlocked.code, 'rate_limit_form_exceeded');

  // After 1 hour sliding window elapses, both reset cleanly.
  assert.equal(limiter.checkAndConsume({ ipKey: '198.51.100.1', formKey: 'f1', ipLimit: 2, formLimit: 3, nowMs: t0 + 3600_001 }).allowed, true);
});

test('normalizeSignupForm validates fields and buildEmbedSnippet escapes HTML with honeypot & UTM capture', () => {
  assert.equal(optinModel.normalizeSignupForm({ name: 'Bad', slug: 'INVALID SLUG!', consentText: 'Yes' }).ok, false);
  assert.equal(optinModel.normalizeSignupForm({ name: 'Missing consent', slug: 'good-slug', consentText: '' }).ok, false);
  assert.equal(optinModel.normalizeSignupForm({ name: 'Bad honeypot', slug: 'good-slug', consentText: 'Yes', honeypotField: 'email' }).ok, false);
  assert.equal(optinModel.normalizeSignupForm({ name: 'Bad URL', slug: 'good-slug', consentText: 'Yes', confirmationBaseUrl: 'javascript:alert(1)' }).ok, false);

  const ok = optinModel.normalizeSignupForm({
    name: 'Launch <script>alert(1)</script>',
    slug: 'launch-list',
    consentText: 'Receive updates & "alerts"',
    honeypotField: 'website_url',
  });
  assert.equal(ok.ok, true);
  const snippet = optinModel.buildEmbedSnippet(ok.form, 'https://example.com/api/marketing');
  assert.doesNotMatch(snippet.html, /<script>alert\(1\)<\/script>/);
  assert.ok(snippet.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(snippet.html.includes('name="website_url"'));
  assert.ok(snippet.html.includes('utm_campaign'));
  assert.equal(snippet.submitEndpoint, 'https://example.com/api/marketing/audience/signup-forms/launch-list/submit');
});

test('double opt-in routes enforce auth, omit signing_secret, silent honeypot, suppression immunity, rate limits, pending->confirmed, single-use replay, forged/expired refusals, and two-owner isolation', async () => {
  let nowMs = Date.parse('2026-11-25T18:00:00.000Z');
  const pool = makeInMemoryOptInPool();
  const limiter = new optinModel.SlidingWindowRateLimiter();
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir, optInRateLimiter: limiter, nowMs: () => nowMs });

  // Unauthenticated refused 401.
  assert.equal((await callRoute(router, 'GET', '/audience/signup-forms', { sub: null })).statusCode, 401);

  // Create sign-up form; signing_secret NEVER returned.
  const created = await callRoute(router, 'POST', '/audience/signup-forms', {
    body: {
      name: 'Launch Waitlist',
      slug: 'launch-waitlist',
      consentText: 'Yes, email me launch updates.',
      listId: UUID_LIST,
      rateLimitPerIpPerHour: 3,
      rateLimitPerFormPerHour: 10,
      tokenTtlMinutes: 60,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal('signing_secret' in created.body.form, false);
  assert.equal('signingSecret' in created.body.form, false);
  assert.ok(created.body.snippet.html.includes('company_website'));

  // GET list also omits signing_secret.
  const listed = await callRoute(router, 'GET', '/audience/signup-forms');
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.forms.length, 1);
  assert.equal('signing_secret' in listed.body.forms[0], false);

  // GET snippet succeeds for owner A, 404 for owner B.
  assert.equal((await callRoute(router, 'GET', '/audience/signup-forms/:slug/snippet', { params: { slug: 'launch-waitlist' } })).statusCode, 200);
  assert.equal((await callRoute(router, 'GET', '/audience/signup-forms/:slug/snippet', { sub: 'owner-b', params: { slug: 'launch-waitlist' } })).statusCode, 404);
  assert.equal((await callRoute(router, 'DELETE', '/audience/signup-forms/:slug', { sub: 'owner-b', params: { slug: 'launch-waitlist' } })).statusCode, 404);

  // Honeypot submission returns generic acknowledgement and writes ZERO DB rows.
  const hpRes = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    ip: '198.51.100.50',
    body: { email: 'bot@example.com', company_website: 'https://spam.example', returnPreviewLink: true },
  });
  assert.equal(hpRes.statusCode, 200);
  assert.deepEqual(hpRes.body, optinModel.buildGenericAckResponse());
  assert.equal(pool.contacts.size, 0);
  assert.equal(pool.consents.size, 0);
  assert.equal(pool.tokens.size, 0);

  // Suppressed email returns identical generic acknowledgement and writes ZERO re-subscription rows.
  const suppHash = audienceModel.hashAddress('suppressed@example.com');
  pool.suppressions.set(`owner-a:${suppHash}`, { suppression_id: 'supp-1', owner_sub: 'owner-a', channel: 'email', address_hash: suppHash });
  const suppRes = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    ip: '198.51.100.51',
    body: { email: '  SUPPRESSED@Example.COM ', returnPreviewLink: true },
  });
  assert.equal(suppRes.statusCode, 200);
  assert.deepEqual(suppRes.body, optinModel.buildGenericAckResponse());
  assert.equal(pool.contacts.size, 0);
  assert.equal(pool.consents.size, 0);

  // Default submit returns acknowledgement ONLY (no preview leak) and writes pending consent + UTM evidence + hashed token only.
  const defaultSub = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    ip: '198.51.100.60',
    headers: { 'user-agent': 'TestBrowser/1.0' },
    body: { email: 'alice@example.com', displayName: 'Alice', utm_source: 'blog', utm_medium: 'organic', utm_campaign: 'p1-launch' },
  });
  assert.equal(defaultSub.statusCode, 200);
  assert.deepEqual(defaultSub.body, optinModel.buildGenericAckResponse());
  assert.equal(pool.contacts.size, 1);
  assert.equal(pool.consents.size, 1);
  assert.equal(pool.memberships.length, 1);
  const pendingConsent = [...pool.consents.values()][0];
  assert.equal(pendingConsent.status, 'pending');
  assert.equal(pendingConsent.evidence.formText, 'Yes, email me launch updates.');
  assert.deepEqual(pendingConsent.evidence.utm, { utm_source: 'blog', utm_medium: 'organic', utm_campaign: 'p1-launch' });
  assert.equal(pendingConsent.evidence.doubleOptIn, true);
  const storedToken = [...pool.tokens.values()][0];
  assert.match(storedToken.token_hash, /^[0-9a-f]{64}$/);

  // Owner preview submit returns confirmation token for end-to-end confirm testing.
  const previewSub = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    ip: '198.51.100.60',
    body: { email: 'bob@example.com', utm_source: 'spark', utm_campaign: 'launch', returnPreviewLink: true },
  });
  assert.equal(previewSub.statusCode, 200);
  assert.ok(previewSub.body.preview?.token);
  const bobToken = previewSub.body.preview.token;

  // Owner B cannot confirm Owner A's token (400 token_forged).
  const crossConfirm = await callRoute(router, 'POST', '/audience/opt-in/confirm', { sub: 'owner-b', body: { token: bobToken } });
  assert.equal(crossConfirm.statusCode, 400);
  assert.equal(crossConfirm.body.error, 'token_forged');

  // Forged token refused 400.
  const forged = await callRoute(router, 'POST', '/audience/opt-in/confirm', { body: { token: `${bobToken}tamper` } });
  assert.equal(forged.statusCode, 400);
  assert.equal(forged.body.error, 'token_forged');

  // Confirm valid token flips pending -> confirmed with confirmedAt + confirmedVia.
  const confirmed = await callRoute(router, 'POST', '/audience/opt-in/confirm', { body: { token: bobToken } });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.confirmed, true);
  assert.equal(confirmed.body.status, 'confirmed');
  const bobConsent = pool.consents.get(confirmed.body.consentId);
  assert.equal(bobConsent.status, 'confirmed');
  assert.equal(bobConsent.evidence.confirmedVia, 'double_opt_in');
  assert.ok(bobConsent.evidence.confirmedAt);

  // Replaying SAME token refused 409 token_already_used.
  const replay = await callRoute(router, 'POST', '/audience/opt-in/confirm', { body: { token: bobToken } });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.error, 'token_already_used');

  // Third submit from same IP succeeds (cap=3), 4th trips 429 rate_limit_ip_exceeded.
  const thirdSub = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    ip: '198.51.100.60',
    body: { email: 'carol@example.com', returnPreviewLink: true },
  });
  assert.equal(thirdSub.statusCode, 200);
  const fourthSub = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    ip: '198.51.100.60',
    body: { email: 'dave@example.com' },
  });
  assert.equal(fourthSub.statusCode, 429);
  assert.equal(fourthSub.body.error, 'rate_limit_ip_exceeded');

  // Advance clock past token TTL -> Carol's token refused 410 token_expired.
  nowMs += 61 * 60_000;
  const expiredRes = await callRoute(router, 'POST', '/audience/opt-in/confirm', { body: { token: thirdSub.body.preview.token } });
  assert.equal(expiredRes.statusCode, 410);
  assert.equal(expiredRes.body.error, 'token_expired');
});
