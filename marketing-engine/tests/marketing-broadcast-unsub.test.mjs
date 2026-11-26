/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Comprehensive unit and compiled-route tests
 *     for marketing-engine 0.6.5 P1 one-click unsubscribe and broadcast pipeline: HMAC-SHA256
 *     per-recipient/per-list unsubscribe tokens + forgery refusal, RFC 8058 header builder
 *     (CRLF & non-http(s) rejection), every broadcast send gate refusal (channel consent OFF,
 *     daily cap 0, incomplete compliance postal address, missing confirm: true -> 428),
 *     mixed-list eligibility & per-recipient delivery ledger (confirmed vs pending vs
 *     suppressed vs cap overflow), live confirmed Resend rail dispatch with RFC 8058 headers
 *     and honest unconnected degradation, one-click unsubscribe immediate suppression + consent
 *     revocation + next-run skip, recipient preferences, and two-owner isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const bcModel = require(join(pkgDir, 'routes', 'marketing-broadcast-model.js'));
const audienceModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));

const UUID_LIST = '11111111-1111-4111-8111-111111111111';
const UUID_LIST_2 = '11111111-1111-4111-8111-111111111112';
const UUID_MSG = '22222222-2222-4222-8222-222222222222';
const UUID_C1 = '33333333-3333-4333-8333-333333333331';
const UUID_C2 = '33333333-3333-4333-8333-333333333332';
const UUID_C3 = '33333333-3333-4333-8333-333333333333';
const UUID_C4 = '33333333-3333-4333-8333-333333333334';
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

const VALID_COMPLIANCE = {
  sender_name: 'Open Swarm Team',
  sender_email: 'news@example.com',
  reply_to_email: 'replies@example.com',
  postal_address: '500 Coast Blvd, Suite 10, Pensacola, FL 32502',
  unsubscribe_base_url: 'https://example.com/unsubscribe',
  sms_quiet_start_hour: 21,
  sms_quiet_end_hour: 8,
  sms_default_timezone: 'America/New_York',
};

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
    '@/app/connectors/runtime': {
      loadConnectorSpec: () => null,
      resolveConnectorActionCreds: async () => null,
      runConnectorAction: async () => ({ status: 500, body: { ok: false } }),
    },
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
async function callRoute(router, method, routePath, { sub = 'owner-a', params = {}, query = {}, body = {}, headers = {} } = {}) {
  const entry = router.routes.find((r) => r.method === method && r.path === routePath);
  assert.ok(entry, `route registered: ${method} ${routePath}`);
  const req = { method, path: routePath, params, query, body, headers, oidc: sub ? { user: { sub } } : null };
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

/** Create an in-memory relational store implementing SQL used by marketing-broadcast.js. */
function makeInMemoryBroadcastPool() {
  const lists = new Map([
    [`owner-a:${UUID_LIST}`, { list_id: UUID_LIST, owner_sub: 'owner-a', slug: 'launch', name: 'Launch List' }],
    [`owner-a:${UUID_LIST_2}`, { list_id: UUID_LIST_2, owner_sub: 'owner-a', slug: 'beta', name: 'Beta List' }],
  ]);
  const contacts = new Map();
  const consents = [];
  const memberships = [];
  const suppressions = new Map();
  const channels = new Map();
  const compliance = new Map();
  const messages = new Map();
  const deliveries = [];
  const runLedger = [];
  let seq = 0;

  const seedContact = (ownerSub, id, email, consentStatus, listId = UUID_LIST) => {
    const emailHash = audienceModel.hashAddress(email);
    contacts.set(id, { contact_id: id, owner_sub: ownerSub, email, email_hash: emailHash, display_name: email.split('@')[0], status: 'active' });
    if (listId) memberships.push({ owner_sub: ownerSub, list_id: listId, contact_id: id, added_at: new Date().toISOString() });
    if (consentStatus) {
      consents.push({
        consent_id: `99999999-9999-4999-8999-${String(++seq).padStart(12, '0')}`,
        owner_sub: ownerSub, contact_id: id, channel: 'email', purpose: 'marketing', status: consentStatus,
        evidence: { formText: 'Opt-in form' }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    return emailHash;
  };

  const query = async (sql, params = []) => {
    if (sql.includes('SELECT list_id FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2')) {
      const row = lists.get(`${params[1]}:${params[0]}`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('SELECT list_id, slug, name FROM oshal_marketing_lists WHERE owner_sub = $1')) {
      const rows = [...lists.values()].filter((l) => l.owner_sub === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO oshal_marketing_messages')) {
      const id = `22222222-2222-4222-8222-${String(++seq).padStart(12, '0')}`;
      const row = {
        message_id: id, owner_sub: params[0], campaign_id: params[1], list_id: params[2], template_id: params[3],
        subject: params[4], headline: params[5], intro: params[6], body: params[7], cta_label: params[8],
        cta_url: params[9], status: 'draft', signing_secret: params[10], stats: {},
        created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z',
      };
      messages.set(id, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_messages') && sql.includes('WHERE owner_sub = $1') && !sql.includes('message_id = $1')) {
      const rows = [...messages.values()].filter((m) => m.owner_sub === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_messages') && sql.includes('WHERE message_id = $1 AND owner_sub = $2')) {
      const row = messages.get(params[0]);
      return { rows: row && row.owner_sub === params[1] ? [row] : [], rowCount: row && row.owner_sub === params[1] ? 1 : 0 };
    }
    if (sql.includes('UPDATE oshal_marketing_messages')) {
      const row = messages.get(params[2]);
      if (!row || row.owner_sub !== params[3]) return { rows: [], rowCount: 0 };
      row.status = params[0];
      row.stats = JSON.parse(params[1]);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('DELETE FROM oshal_marketing_deliveries')) {
      for (let i = deliveries.length - 1; i >= 0; i -= 1) {
        if (deliveries[i].owner_sub === params[0] && deliveries[i].message_id === params[1] && deliveries[i].status !== 'sent') {
          deliveries.splice(i, 1);
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_deliveries')) {
      const row = {
        delivery_id: `44444444-4444-4444-8444-${String(++seq).padStart(12, '0')}`,
        owner_sub: params[0], message_id: params[1], contact_id: params[2], email_hash: params[3],
        status: params[4], gate_reason: params[5], provider_ref: params[6], created_at: new Date().toISOString(),
      };
      deliveries.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_deliveries') && sql.includes('WHERE message_id = $1 AND owner_sub = $2')) {
      const rows = deliveries.filter((d) => d.message_id === params[0] && d.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_channel_authorizations')) {
      const row = channels.get(`${params[0]}:email`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_run_ledger')) {
      const n = runLedger.filter((r) => r.user_sub === params[0] && r.channel === params[1] && !String(r.outcome).startsWith('skipped')).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_run_ledger')) {
      runLedger.push({ user_sub: params[0], channel: params[1], action: params[2], outcome: params[3], detail: JSON.parse(params[4]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_compliance_settings')) {
      const row = compliance.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_list_members m') && sql.includes('JOIN oshal_marketing_contacts c')) {
      const rows = memberships
        .filter((m) => m.list_id === params[0] && m.owner_sub === params[1])
        .map((m) => contacts.get(m.contact_id))
        .filter(Boolean);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('SELECT contact_id, status') && sql.includes('FROM oshal_marketing_consents')) {
      const rows = consents.filter((c) => c.owner_sub === params[0] && c.channel === 'email').reverse();
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('SELECT channel, purpose, status, updated_at FROM oshal_marketing_consents')) {
      const rows = consents.filter((c) => c.contact_id === params[0] && c.owner_sub === params[1]).reverse();
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('SELECT list_id, added_at FROM oshal_marketing_list_members')) {
      const rows = memberships.filter((m) => m.contact_id === params[0] && m.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('DELETE FROM oshal_marketing_list_members WHERE contact_id = $1 AND owner_sub = $2')) {
      for (let i = memberships.length - 1; i >= 0; i -= 1) {
        if (memberships[i].contact_id === params[0] && memberships[i].owner_sub === params[1]) memberships.splice(i, 1);
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_list_members')) {
      if (!memberships.some((m) => m.list_id === params[1] && m.contact_id === params[2])) {
        memberships.push({ owner_sub: params[0], list_id: params[1], contact_id: params[2], added_at: new Date().toISOString() });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = \'email\'')) {
      const rows = [...suppressions.values()].filter((s) => s.owner_sub === params[0] && s.channel === 'email');
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_suppressions WHERE address_hash = $1 AND owner_sub = $2')) {
      const rows = [...suppressions.values()].filter((s) => s.address_hash === params[0] && s.owner_sub === params[1]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO oshal_marketing_suppressions')) {
      const isRfc = sql.includes("'one_click_unsubscribe'");
      const channel = isRfc ? 'email' : params[1];
      const addressHash = isRfc ? params[1] : params[2];
      const key = `${params[0]}:${channel}:${addressHash}`;
      const row = {
        suppression_id: `55555555-5555-4555-8555-${String(++seq).padStart(12, '0')}`,
        owner_sub: params[0], channel, address_hash: addressHash,
        reason: isRfc ? 'one_click_unsubscribe' : 'preference_opt_out',
        source: isRfc ? 'rfc8058' : 'preferences',
        created_at: new Date().toISOString(),
      };
      suppressions.set(key, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('UPDATE oshal_marketing_consents')) {
      let count = 0;
      const isPref = sql.includes('channel = $3');
      const channel = isPref ? params[2] : 'email';
      const patch = JSON.parse(isPref ? params[3] : params[2]);
      for (const c of consents) {
        if (c.owner_sub === params[0] && c.contact_id === params[1] && c.channel === channel && c.status !== 'revoked') {
          c.status = 'revoked';
          c.evidence = { ...c.evidence, ...patch };
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (sql.includes('UPDATE oshal_marketing_contacts')) {
      for (const c of contacts.values()) {
        if (c.owner_sub === params[0] && (c.contact_id === params[1] || (params[2] && c.email_hash === params[2]))) {
          c.status = 'unsubscribed';
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2')) {
      const row = contacts.get(params[0]);
      return { rows: row && row.owner_sub === params[1] ? [row] : [], rowCount: row && row.owner_sub === params[1] ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  };

  return { lists, contacts, consents, memberships, suppressions, channels, compliance, messages, deliveries, runLedger, seedContact, query };
}

test('signed unsubscribe tokens verify in constant time and refuse tampered, wrong-secret, or wrong-owner tokens', () => {
  const emailHash = audienceModel.hashAddress('alice@example.com');
  const token = bcModel.mintUnsubscribeToken({
    ownerSub: 'owner-a', contactId: UUID_C1, emailHash, listId: UUID_LIST, messageId: UUID_MSG,
  }, SECRET_A);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const ok = bcModel.verifyUnsubscribeToken(token, SECRET_A, 'owner-a');
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.contactId, UUID_C1);
  assert.equal(ok.payload.listId, UUID_LIST);
  assert.equal(ok.payload.emailHash, emailHash);

  // Tampered payload refused.
  const [p, s] = token.split('.');
  const fakePayload = Buffer.from(JSON.stringify({ ...ok.payload, listId: UUID_LIST_2 }), 'utf8').toString('base64url');
  assert.deepEqual(bcModel.verifyUnsubscribeToken(`${fakePayload}.${s}`, SECRET_A, 'owner-a'), { ok: false, error: 'unsubscribe_token_forged' });

  // Tampered signature refused.
  const badSig = `${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.deepEqual(bcModel.verifyUnsubscribeToken(`${p}.${badSig}`, SECRET_A, 'owner-a'), { ok: false, error: 'unsubscribe_token_forged' });

  // Wrong secret refused.
  assert.deepEqual(bcModel.verifyUnsubscribeToken(token, SECRET_B, 'owner-a'), { ok: false, error: 'unsubscribe_token_forged' });

  // Wrong owner refused.
  assert.deepEqual(bcModel.verifyUnsubscribeToken(token, SECRET_A, 'owner-b'), { ok: false, error: 'unsubscribe_token_forged' });

  // Malformed token refused.
  assert.deepEqual(bcModel.verifyUnsubscribeToken('not-a-token', SECRET_A), { ok: false, error: 'unsubscribe_token_forged' });
});

test('buildRfc8058Headers emits strictly List-Unsubscribe + List-Unsubscribe-Post and rejects CRLF or non-http(s) URLs', () => {
  const headers = bcModel.buildRfc8058Headers('https://example.com/unsubscribe?token=abc.def');
  assert.deepEqual(Object.keys(headers).sort(), ['List-Unsubscribe', 'List-Unsubscribe-Post']);
  assert.equal(headers['List-Unsubscribe'], '<https://example.com/unsubscribe?token=abc.def>');
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  assert.throws(() => bcModel.buildRfc8058Headers('https://example.com/unsub\r\nBcc: evil@example.com'), /invalid_unsubscribe_url|control/i);
  assert.throws(() => bcModel.buildRfc8058Headers('https://example.com/unsub\nX-Injected: 1'), /invalid_unsubscribe_url|control/i);
  assert.throws(() => bcModel.buildRfc8058Headers('javascript:alert(1)'), /https?:\/\//i);
  assert.throws(() => bcModel.buildRfc8058Headers('mailto:unsub@example.com'), /https?:\/\//i);
  assert.throws(() => bcModel.buildRfc8058Headers('https://example.com/unsub><evil'), /control|invalid/i);
});

test('broadcast send gate chain enforces every gate refusal, mixed-list eligibility, cap overflow, live Resend dispatch, one-click unsubscribe suppression, preferences, and two-owner isolation', async () => {
  const pool = makeInMemoryBroadcastPool();
  const c1Hash = pool.seedContact('owner-a', UUID_C1, 'confirmed1@example.com', 'confirmed');
  pool.seedContact('owner-a', UUID_C2, 'pending@example.com', 'pending');
  const c3Hash = pool.seedContact('owner-a', UUID_C3, 'suppressed@example.com', 'confirmed');
  pool.seedContact('owner-a', UUID_C4, 'confirmed2@example.com', 'confirmed');
  pool.suppressions.set(`owner-a:email:${c3Hash}`, {
    suppression_id: 'supp-seed', owner_sub: 'owner-a', channel: 'email', address_hash: c3Hash, reason: 'manual', source: 'manual',
  });

  const sentCalls = [];
  let resendConnected = true;
  const mockSpec = {
    actions: [{ name: 'send-email', parameters: { properties: { from: {}, to: {}, subject: {}, html: {}, text: {}, headers: {} } } }],
  };
  const routesMod = loadCompiledModule('routes/marketing-routes.js', {
    '@/app/connectors/runtime': {
      loadConnectorSpec: () => mockSpec,
      resolveConnectorActionCreds: async () => ({ token: 'resend-key' }),
      runConnectorAction: async (opts) => {
        sentCalls.push(opts.params);
        if (!resendConnected) return { status: 409, body: { ok: false, code: 'not_connected' } };
        return { status: 200, body: { ok: true, data: { id: `re_msg_${sentCalls.length}` } } };
      },
    },
  });
  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });

  // Unauthenticated refused 401.
  assert.equal((await callRoute(router, 'GET', '/broadcasts', { sub: null })).statusCode, 401);

  // Create broadcast draft; signing_secret NEVER returned.
  const created = await callRoute(router, 'POST', '/broadcasts', {
    body: {
      listId: UUID_LIST,
      templateId: 'announcement',
      subject: 'Open Swarm P1 Broadcast',
      headline: 'Broadcast Headline',
      body: 'Hello confirmed subscribers!',
      ctaLabel: 'Read notes',
      ctaUrl: 'https://example.com/notes',
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal('signing_secret' in created.body.broadcast, false);
  const msgId = created.body.broadcast.message_id;

  // Owner B gets 404 on broadcast read & send.
  assert.equal((await callRoute(router, 'GET', '/broadcasts/:id', { sub: 'owner-b', params: { id: msgId } })).statusCode, 404);
  assert.equal((await callRoute(router, 'POST', '/broadcasts/:id/send', { sub: 'owner-b', params: { id: msgId }, body: { dryRun: true } })).statusCode, 404);

  // Gate 1a: Channel consent OFF -> 403 skipped_consent + delivery ledger rows!
  const noConsent = await callRoute(router, 'POST', '/broadcasts/:id/send', { params: { id: msgId }, body: { dryRun: true } });
  assert.equal(noConsent.statusCode, 403);
  assert.equal(noConsent.body.error, 'skipped_consent');
  assert.equal(noConsent.body.deliveries.length, 4);
  assert.ok(noConsent.body.deliveries.every((d) => d.status === 'skipped_consent'));

  // Gate 1b: Channel enabled but daily_cap = 0 -> 403 skipped_cap + ledger rows!
  pool.channels.set('owner-a:email', { user_sub: 'owner-a', channel: 'email', enabled: true, daily_cap: 0 });
  const zeroCap = await callRoute(router, 'POST', '/broadcasts/:id/send', { params: { id: msgId }, body: { dryRun: true } });
  assert.equal(zeroCap.statusCode, 403);
  assert.equal(zeroCap.body.error, 'skipped_cap');
  assert.ok(zeroCap.body.deliveries.every((d) => d.status === 'skipped_cap'));

  // Gate 2: Channel armed (cap=1), compliance postal address missing -> 422 skipped_compliance + ledger rows!
  pool.channels.set('owner-a:email', { user_sub: 'owner-a', channel: 'email', enabled: true, daily_cap: 1 });
  pool.compliance.set('owner-a', { ...VALID_COMPLIANCE, postal_address: '' });
  const noPostal = await callRoute(router, 'POST', '/broadcasts/:id/send', { params: { id: msgId }, body: { dryRun: true } });
  assert.equal(noPostal.statusCode, 422);
  assert.equal(noPostal.body.error, 'skipped_compliance');
  assert.ok(noPostal.body.deliveries.every((d) => d.status === 'skipped_compliance'));

  // Set full valid compliance settings.
  pool.compliance.set('owner-a', { ...VALID_COMPLIANCE });

  // Gate 3: Live send without confirm: true -> 428 confirmation_required (zero Resend calls!).
  const unconfirmedLive = await callRoute(router, 'POST', '/broadcasts/:id/send', { params: { id: msgId }, body: {} });
  assert.equal(unconfirmedLive.statusCode, 428);
  assert.equal(unconfirmedLive.body.error, 'confirmation_required');
  assert.equal(sentCalls.length, 0);

  // Gate 4 (Dry-run with cap=1): c1=dry_run, c2=skipped_unconfirmed, c3=skipped_suppressed, c4=skipped_cap!
  const dry1 = await callRoute(router, 'POST', '/broadcasts/:id/send', {
    params: { id: msgId },
    body: { dryRun: true, includeUnsubscribePreviewTokens: true },
  });
  assert.equal(dry1.statusCode, 200);
  assert.equal(dry1.body.dryRun, true);
  assert.equal(dry1.body.stats.dryRun, 1);
  assert.equal(dry1.body.stats.skippedUnconfirmed, 1);
  assert.equal(dry1.body.stats.skippedSuppressed, 1);
  assert.equal(dry1.body.stats.skippedCap, 1);
  assert.equal(dry1.body.deliveries.length, 4);
  const byContact = new Map(dry1.body.deliveries.map((d) => [d.contact_id, d.status]));
  assert.equal(byContact.get(UUID_C1), 'dry_run');
  assert.equal(byContact.get(UUID_C2), 'skipped_unconfirmed');
  assert.equal(byContact.get(UUID_C3), 'skipped_suppressed');
  assert.equal(byContact.get(UUID_C4), 'skipped_cap');
  assert.equal(sentCalls.length, 0);
  assert.equal(dry1.body.previewTokens.length, 1);
  assert.equal(dry1.body.previewTokens[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const c1Token = dry1.body.previewTokens[0].unsubscribeToken;

  // Forged unsubscribe token & cross-owner token refused 400.
  assert.equal((await callRoute(router, 'POST', '/audience/unsubscribe', { body: { token: `${c1Token}tamper` } })).statusCode, 400);
  assert.equal((await callRoute(router, 'POST', '/audience/unsubscribe', { sub: 'owner-b', body: { token: c1Token } })).statusCode, 400);

  // One-click unsubscribe (RFC 8058 query token + List-Unsubscribe=One-Click body) suppresses & revokes c1 immediately!
  const unsubRes = await callRoute(router, 'POST', '/audience/unsubscribe', {
    query: { token: c1Token },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(unsubRes.statusCode, 200);
  assert.equal(unsubRes.body.unsubscribed, true);
  assert.equal(unsubRes.body.suppressed, true);
  assert.equal(unsubRes.body.revokedConsents, 1);
  assert.equal(pool.contacts.get(UUID_C1).status, 'unsubscribed');
  assert.ok(pool.suppressions.has(`owner-a:email:${c1Hash}`));

  // Next dry-run (with cap=5): c1 is NOW skipped_suppressed, c4 is eligible (dry_run)!
  pool.channels.set('owner-a:email', { user_sub: 'owner-a', channel: 'email', enabled: true, daily_cap: 5 });
  const dry2 = await callRoute(router, 'POST', '/broadcasts/:id/send', { params: { id: msgId }, body: { dryRun: true } });
  assert.equal(dry2.statusCode, 200);
  const byContact2 = new Map(dry2.body.deliveries.map((d) => [d.contact_id, d.status]));
  assert.equal(byContact2.get(UUID_C1), 'skipped_suppressed');
  assert.equal(byContact2.get(UUID_C2), 'skipped_unconfirmed');
  assert.equal(byContact2.get(UUID_C3), 'skipped_suppressed');
  assert.equal(byContact2.get(UUID_C4), 'dry_run');

  // Live confirmed send reaches ONLY c4, carrying HTML, text, postal address, signed unsubscribe URL, and RFC 8058 headers!
  const live = await callRoute(router, 'POST', '/broadcasts/:id/send', { params: { id: msgId }, body: { confirm: true } });
  assert.equal(live.statusCode, 200);
  assert.equal(live.body.status, 'sent');
  assert.equal(live.body.stats.sent, 1);
  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].to, 'confirmed2@example.com');
  assert.ok(sentCalls[0].html.includes('500 Coast Blvd, Suite 10, Pensacola, FL 32502'));
  assert.ok(sentCalls[0].text.includes('https://example.com/unsubscribe?token='));
  assert.equal(sentCalls[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Inspect stored broadcast ledger omits signing_secret and contains all 4 recipient decisions.
  const inspected = await callRoute(router, 'GET', '/broadcasts/:id', { params: { id: msgId } });
  assert.equal(inspected.statusCode, 200);
  assert.equal('signing_secret' in inspected.body.broadcast, false);
  assert.equal(inspected.body.deliveries.length, 4);

  // Honest degradation when Resend is unconnected records error status.
  resendConnected = false;
  const created2 = await callRoute(router, 'POST', '/broadcasts', {
    body: { listId: UUID_LIST, templateId: 'launch', subject: 'Unconnected Test', body: 'Launch body.' },
  });
  const liveUnconn = await callRoute(router, 'POST', '/broadcasts/:id/send', {
    params: { id: created2.body.broadcast.message_id },
    body: { confirm: true },
  });
  assert.equal(liveUnconn.statusCode, 200);
  assert.equal(liveUnconn.body.status, 'blocked');
  assert.equal(liveUnconn.body.stats.error, 1);

  // Recipient preferences GET + PUT (list membership + opt-out) & foreign owner 404.
  assert.equal((await callRoute(router, 'GET', '/audience/preferences/:contactId', { sub: 'owner-b', params: { contactId: UUID_C4 } })).statusCode, 404);
  const prefGet = await callRoute(router, 'GET', '/audience/preferences/:contactId', { params: { contactId: UUID_C4 } });
  assert.equal(prefGet.statusCode, 200);
  assert.equal(prefGet.body.channels.email.suppressed, false);

  const prefPut = await callRoute(router, 'PUT', '/audience/preferences/:contactId', {
    params: { contactId: UUID_C4 },
    body: { listIds: [UUID_LIST_2], emailOptOut: true },
  });
  assert.equal(prefPut.statusCode, 200);
  assert.equal(prefPut.body.channels.email.suppressed, true);
  assert.equal(prefPut.body.channels.email.consentStatus, 'revoked');
  assert.equal(prefPut.body.lists.find((l) => l.list_id === UUID_LIST_2).subscribed, true);
  assert.equal(prefPut.body.lists.find((l) => l.list_id === UUID_LIST).subscribed, false);
});
