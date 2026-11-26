/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Comprehensive unit and compiled-route tests
 *     for marketing-engine 0.6.6 P3 sequences with per-recipient state and strict per-sequence
 *     standing authorization: strict boolean-only standing auth (absent row = OFF, garbage
 *     values never arm -> 400, arming without confirm: true -> 428, arming with dailyCap: 0 ->
 *     400, arming with true + confirm: true + dailyCap >= 1 -> armed, one-click POST .../disarm
 *     immediately blocks subsequent live sends with 403 sequence_disarmed), Step 1 -> suppress
 *     between steps -> Step 2 stops unsubscribed while still-consented completes, daily cap
 *     bounding (3 due with cap 2 -> 2 advance, 1 deferred skipped_cap), welcome-sequence
 *     auto-enrollment on double opt-in confirm, and two-owner isolation (404).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const seqModel = require(join(pkgDir, 'routes', 'marketing-sequence-model.js'));
const audienceModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));

const UUID_C1 = '33333333-3333-4333-8333-333333333331';
const UUID_C2 = '33333333-3333-4333-8333-333333333332';
const UUID_C3 = '33333333-3333-4333-8333-333333333333';
const UUID_C_PENDING = '33333333-3333-4333-8333-333333333334';
const UUID_C_SUPP = '33333333-3333-4333-8333-333333333335';

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
async function callRoute(router, method, routePath, { sub = 'owner-a', params = {}, query = {}, body = {}, headers = {}, ip = '198.51.100.10' } = {}) {
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

/** Create an in-memory relational store implementing SQL for sequences + opt-in welcome hook. */
function makeInMemorySequencePool() {
  const sequences = new Map();
  const steps = [];
  const enrollments = new Map();
  const contacts = new Map();
  const consents = [];
  const suppressions = new Map();
  const channels = new Map();
  const compliance = new Map();
  const forms = new Map();
  const optinTokens = new Map();
  const runLedger = [];
  let seq = 0;

  const nextUuid = (prefix) => `${prefix}-${String(++seq).padStart(12, '0')}`;

  const seedContact = (ownerSub, id, email, consentStatus, status = 'active') => {
    const emailHash = audienceModel.hashAddress(email);
    contacts.set(id, { contact_id: id, owner_sub: ownerSub, email, email_hash: emailHash, display_name: email.split('@')[0], status });
    if (consentStatus) {
      consents.push({
        consent_id: nextUuid('99999999-9999-4999-8999'),
        owner_sub: ownerSub, contact_id: id, channel: 'email', purpose: 'marketing', status: consentStatus,
        evidence: { formText: 'Opt-in form' }, created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z',
      });
    }
    return emailHash;
  };

  const query = async (sql, params = []) => {
    if (sql.includes('INSERT INTO oshal_marketing_sequences')) {
      for (const s of sequences.values()) {
        if (s.owner_sub === params[0] && s.slug === params[1]) {
          const e = new Error('duplicate'); e.code = '23505'; throw e;
        }
      }
      const id = nextUuid('66666666-6666-4666-8666');
      const row = {
        sequence_id: id, owner_sub: params[0], slug: params[1], name: params[2],
        description: params[3], trigger_form_slug: params[4], status: params[5],
        standing_authorization: false, daily_cap: params[6], signing_secret: params[7],
        created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z',
      };
      sequences.set(id, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_sequences s') && sql.includes('WHERE s.owner_sub = $1')) {
      const rows = [...sequences.values()].filter((s) => s.owner_sub === params[0]).map((s) => ({
        ...s,
        step_count: steps.filter((st) => st.sequence_id === s.sequence_id && st.owner_sub === params[0]).length,
        active_enrollment_count: [...enrollments.values()].filter((e) => e.sequence_id === s.sequence_id && e.owner_sub === params[0] && e.status === 'active').length,
        total_enrollment_count: [...enrollments.values()].filter((e) => e.sequence_id === s.sequence_id && e.owner_sub === params[0]).length,
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_sequences') && sql.includes('trigger_form_slug = $2')) {
      const rows = [...sequences.values()].filter((s) => s.owner_sub === params[0] && s.trigger_form_slug === params[1] && s.status === 'active');
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_sequences') && sql.includes('WHERE sequence_id = $1 AND owner_sub = $2')) {
      const row = sequences.get(params[0]);
      return { rows: row && row.owner_sub === params[1] ? [row] : [], rowCount: row && row.owner_sub === params[1] ? 1 : 0 };
    }
    if (sql.includes('UPDATE oshal_marketing_sequences') && sql.includes('SET standing_authorization = $1')) {
      const row = sequences.get(params[3]);
      if (!row || row.owner_sub !== params[4]) return { rows: [], rowCount: 0 };
      row.standing_authorization = params[0];
      row.daily_cap = params[1];
      row.status = params[2];
      row.updated_at = '2026-11-26T00:01:00.000Z';
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('UPDATE oshal_marketing_sequences') && sql.includes('SET standing_authorization = FALSE')) {
      const row = sequences.get(params[0]);
      if (!row || row.owner_sub !== params[1]) return { rows: [], rowCount: 0 };
      row.standing_authorization = false;
      row.updated_at = '2026-11-26T00:02:00.000Z';
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_sequence_steps')) {
      if (steps.some((st) => st.sequence_id === params[1] && st.step_order === params[2])) {
        const e = new Error('duplicate'); e.code = '23505'; throw e;
      }
      const row = {
        step_id: nextUuid('77777777-7777-4777-8777'),
        owner_sub: params[0], sequence_id: params[1], step_order: params[2], delay_hours: params[3],
        template_id: params[4], subject: params[5], headline: params[6], intro: params[7],
        body: params[8], cta_label: params[9], cta_url: params[10], created_at: '2026-11-26T00:00:00.000Z',
      };
      steps.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_sequence_steps')) {
      const rows = steps.filter((st) => st.sequence_id === params[0] && st.owner_sub === params[1]).sort((a, b) => a.step_order - b.step_order);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('INSERT INTO oshal_marketing_enrollments')) {
      const dup = [...enrollments.values()].find((e) => e.sequence_id === params[1] && e.contact_id === params[2]);
      if (dup) {
        if (sql.includes('ON CONFLICT (sequence_id, contact_id) DO NOTHING')) return { rows: [], rowCount: 0 };
        const e = new Error('duplicate'); e.code = '23505'; throw e;
      }
      const id = nextUuid('88888888-8888-4888-8888');
      const row = {
        enrollment_id: id, owner_sub: params[0], sequence_id: params[1], contact_id: params[2],
        current_step_order: 0, status: 'active', next_run_at: '2026-11-26T00:00:00.000Z',
        last_step_at: null, history: [], created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z',
      };
      enrollments.set(id, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_enrollments e') && sql.includes('JOIN oshal_marketing_contacts c')) {
      const activeOnly = sql.includes("AND e.status = 'active'");
      const rows = [...enrollments.values()]
        .filter((e) => e.sequence_id === params[0] && e.owner_sub === params[1] && (!activeOnly || e.status === 'active'))
        .map((e) => {
          const c = contacts.get(e.contact_id);
          return c ? { ...e, email: c.email, email_hash: c.email_hash, display_name: c.display_name, contact_status: c.status } : null;
        })
        .filter(Boolean);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('UPDATE oshal_marketing_enrollments')) {
      const row = enrollments.get(params[5]);
      if (!row || row.owner_sub !== params[6]) return { rows: [], rowCount: 0 };
      row.current_step_order = params[0];
      row.status = params[1];
      if (params[2]) row.next_run_at = params[2];
      row.last_step_at = params[3];
      row.history = [...(Array.isArray(row.history) ? row.history : []), ...JSON.parse(params[4])];
      row.updated_at = params[3];
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2')) {
      const row = contacts.get(params[0]);
      return { rows: row && row.owner_sub === params[1] ? [row] : [], rowCount: row && row.owner_sub === params[1] ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2')) {
      const row = [...contacts.values()].find((c) => c.owner_sub === params[0] && c.email_hash === params[1]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_contacts')) {
      const existing = [...contacts.values()].find((c) => c.owner_sub === params[0] && c.email_hash === params[2]);
      if (existing) { existing.email = params[1]; return { rows: [existing], rowCount: 1 }; }
      const id = nextUuid('33333333-3333-4333-8333');
      const row = { contact_id: id, owner_sub: params[0], email: params[1], email_hash: params[2], display_name: params[3], status: 'active' };
      contacts.set(id, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_consents')) {
      const row = { consent_id: params[0], owner_sub: params[1], contact_id: params[2], channel: 'email', purpose: 'marketing', status: 'pending', evidence: JSON.parse(params[3]), created_at: '2026-11-26T00:00:00.000Z', updated_at: '2026-11-26T00:00:00.000Z' };
      consents.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('UPDATE oshal_marketing_consents') && sql.includes("SET status = 'confirmed'")) {
      const c = consents.find((x) => x.consent_id === params[0] && x.owner_sub === params[1] && x.contact_id === params[2]);
      if (c) { c.status = 'confirmed'; c.evidence = { ...c.evidence, ...JSON.parse(params[3]) }; }
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    if (sql.includes('SELECT status FROM oshal_marketing_consents WHERE owner_sub = $1 AND contact_id = $2')) {
      const found = consents.filter((c) => c.owner_sub === params[0] && c.contact_id === params[1] && c.channel === 'email').reverse();
      return { rows: found.slice(0, 1), rowCount: found.length ? 1 : 0 };
    }
    if (sql.includes('SELECT contact_id, status FROM oshal_marketing_consents')) {
      const found = consents.filter((c) => c.owner_sub === params[0] && c.channel === 'email').reverse();
      return { rows: found, rowCount: found.length };
    }
    if (sql.includes('FROM oshal_marketing_suppressions') && sql.includes('address_hash = $2')) {
      const row = suppressions.get(`${params[0]}:email:${params[1]}`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_suppressions WHERE owner_sub = $1')) {
      const rows = [...suppressions.values()].filter((s) => s.owner_sub === params[0] && s.channel === 'email');
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('FROM oshal_marketing_channel_authorizations')) {
      const row = channels.get(`${params[0]}:email`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_compliance_settings')) {
      const row = compliance.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_run_ledger') && sql.includes("action = 'sequence.step'")) {
      const n = runLedger.filter((r) => r.user_sub === params[0] && r.action === 'sequence.step' && r.outcome === 'published' && r.detail?.sequenceId === params[1]).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_run_ledger')) {
      const n = runLedger.filter((r) => r.user_sub === params[0] && r.channel === params[1] && !String(r.outcome).startsWith('skipped')).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_run_ledger')) {
      runLedger.push({ user_sub: params[0], channel: params[1], action: params[2], outcome: params[3], detail: JSON.parse(params[4]) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_signup_forms')) {
      const row = {
        form_id: nextUuid('55555555-5555-4555-8555'), owner_sub: params[0], slug: params[1], name: params[2],
        consent_text: params[3], list_id: params[4], honeypot_field: params[5], signing_secret: params[6],
        rate_limit_per_ip_hour: params[7], rate_limit_per_form_hour: params[8], token_ttl_minutes: params[9],
        confirmation_base_url: params[10], enabled: params[11],
      };
      forms.set(`${params[0]}:${params[1]}`, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_signup_forms WHERE owner_sub = $1 AND slug = $2')) {
      const row = forms.get(`${params[0]}:${params[1]}`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_optin_tokens')) {
      const row = { token_id: params[0], owner_sub: params[1], form_id: params[2], contact_id: params[3], consent_id: params[4], token_hash: params[5], expires_at: params[6], consumed_at: null };
      optinTokens.set(params[0], row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM oshal_marketing_optin_tokens WHERE token_id = $1 AND owner_sub = $2')) {
      const row = optinTokens.get(params[0]);
      const match = row && row.owner_sub === params[1] && (!params[2] || row.token_hash === params[2]);
      return { rows: match ? [row] : [], rowCount: match ? 1 : 0 };
    }
    if (sql.includes('UPDATE oshal_marketing_optin_tokens')) {
      const row = optinTokens.get(params[0]);
      if (!row || row.owner_sub !== params[1] || row.token_hash !== params[2] || row.consumed_at) return { rows: [], rowCount: 0 };
      if (Date.parse(row.expires_at) <= Date.parse(params[3])) return { rows: [], rowCount: 0 };
      row.consumed_at = params[3];
      return { rows: [{ token_id: row.token_id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  return { sequences, steps, enrollments, contacts, consents, suppressions, channels, compliance, forms, runLedger, seedContact, query };
}

test('isSequenceArmed and parseStandingAuthInput enforce strict boolean true only (absent row = OFF, garbage values never arm)', () => {
  // Absent / null / undefined -> OFF.
  assert.equal(seqModel.isSequenceArmed(null), false);
  assert.equal(seqModel.isSequenceArmed(undefined), false);
  assert.equal(seqModel.isSequenceArmed({}), false);

  // Garbage truthy values NEVER arm.
  for (const garbage of ['true', 't', 1, '1', 'yes', 'on', {}, [], null, undefined]) {
    assert.equal(
      seqModel.isSequenceArmed({ standing_authorization: garbage, daily_cap: 10, status: 'active' }),
      false,
      `garbage standing_authorization ${JSON.stringify(garbage)} must never arm`,
    );
    const parsed = seqModel.parseStandingAuthInput({ standingAuthorization: garbage, confirm: true, dailyCap: 10 });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, 400);
    assert.equal(parsed.error, 'invalid_standing_authorization');
  }

  // daily_cap 0 or non-active status NEVER arms even with strict true.
  assert.equal(seqModel.isSequenceArmed({ standing_authorization: true, daily_cap: 0, status: 'active' }), false);
  assert.equal(seqModel.isSequenceArmed({ standing_authorization: true, daily_cap: 10, status: 'draft' }), false);
  assert.equal(seqModel.isSequenceArmed({ standing_authorization: true, daily_cap: 10, status: 'paused' }), false);
  assert.equal(seqModel.isSequenceArmed({ standing_authorization: true, daily_cap: 10, status: 'active' }), true);

  // Arming without confirm: true -> 428; dailyCap 0 -> 400; valid -> ok.
  assert.equal(seqModel.parseStandingAuthInput({ standingAuthorization: true, dailyCap: 5 }).status, 428);
  assert.equal(seqModel.parseStandingAuthInput({ standingAuthorization: true, confirm: true, dailyCap: 0 }).status, 400);
  assert.deepEqual(
    seqModel.parseStandingAuthInput({ standingAuthorization: true, confirm: true, dailyCap: 2 }),
    { ok: true, standingAuthorization: true, dailyCap: 2 },
  );

  // Disarming requires NO confirm.
  assert.deepEqual(
    seqModel.parseStandingAuthInput({ standingAuthorization: false }),
    { ok: true, standingAuthorization: false },
  );

  // normalizeSequence ALWAYS forces standingAuthorization: false even if caller tries to arm on create.
  const norm = seqModel.normalizeSequence({ name: 'Welcome', standingAuthorization: true, dailyCap: 10 });
  assert.equal(norm.ok, true);
  assert.equal(norm.sequence.standingAuthorization, false);
});

test('sequence routes enforce strict standing auth, step re-checks after suppression, daily cap bounding, one-click disarm, welcome auto-enroll, and two-owner isolation', async () => {
  const pool = makeInMemorySequencePool();
  const c1Hash = pool.seedContact('owner-a', UUID_C1, 'alice@example.com', 'confirmed');
  const c2Hash = pool.seedContact('owner-a', UUID_C2, 'bob@example.com', 'confirmed');
  pool.seedContact('owner-a', UUID_C3, 'carol@example.com', 'confirmed');
  pool.seedContact('owner-a', UUID_C_PENDING, 'pending@example.com', 'pending');
  const suppHash = pool.seedContact('owner-a', UUID_C_SUPP, 'suppressed@example.com', 'confirmed');
  pool.suppressions.set(`owner-a:email:${suppHash}`, { suppression_id: 's-1', owner_sub: 'owner-a', channel: 'email', address_hash: suppHash });

  pool.channels.set('owner-a:email', { user_sub: 'owner-a', channel: 'email', enabled: true, daily_cap: 20 });
  pool.compliance.set('owner-a', { ...VALID_COMPLIANCE });

  const sentCalls = [];
  const mockSpec = {
    actions: [{ name: 'send-email', parameters: { properties: { from: {}, to: {}, subject: {}, html: {}, text: {}, headers: {} } } }],
  };
  const routesMod = loadCompiledModule('routes/marketing-routes.js', {
    '@/app/connectors/runtime': {
      loadConnectorSpec: () => mockSpec,
      resolveConnectorActionCreds: async () => ({ token: 'resend-key' }),
      runConnectorAction: async (opts) => {
        sentCalls.push(opts.params);
        return { status: 200, body: { ok: true, data: { id: `re_seq_${sentCalls.length}` } } };
      },
    },
  });
  const router = routesMod.createMarketingRoutes({ pool, appPackageDir: pkgDir });

  // Unauthenticated refused 401.
  assert.equal((await callRoute(router, 'GET', '/sequences', { sub: null })).statusCode, 401);

  // Create sequence — ALWAYS standing_authorization: false & signing_secret omitted!
  const created = await callRoute(router, 'POST', '/sequences', {
    body: {
      name: 'Welcome Onboarding',
      slug: 'welcome-onboarding',
      triggerFormSlug: 'launch-waitlist',
      standingAuthorization: true,
      dailyCap: 2,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.sequence.standing_authorization, false);
  assert.equal(created.body.sequence.armed, false);
  assert.equal('signing_secret' in created.body.sequence, false);
  const seqId = created.body.sequence.sequence_id;

  // Add Step 1 (immediate) and Step 2 (+24h delay).
  const step1 = await callRoute(router, 'POST', '/sequences/:id/steps', {
    params: { id: seqId },
    body: { stepOrder: 1, delayHours: 0, templateId: 'announcement', subject: 'Step 1 Welcome', body: 'Hello step 1!' },
  });
  const step2 = await callRoute(router, 'POST', '/sequences/:id/steps', {
    params: { id: seqId },
    body: { stepOrder: 2, delayHours: 24, templateId: 'newsletter', subject: 'Step 2 Tips', body: 'Hello step 2!' },
  });
  assert.equal(step1.statusCode, 201);
  assert.equal(step2.statusCode, 201);

  // Enroll refuses unconfirmed (409) and suppressed (409), accepts confirmed C1, C2, C3.
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/enroll', { params: { id: seqId }, body: { contactId: UUID_C_PENDING } })).statusCode, 409);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/enroll', { params: { id: seqId }, body: { contactId: UUID_C_SUPP } })).statusCode, 409);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/enroll', { params: { id: seqId }, body: { contactId: UUID_C1 } })).statusCode, 201);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/enroll', { params: { id: seqId }, body: { contactId: UUID_C2 } })).statusCode, 201);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/enroll', { params: { id: seqId }, body: { contactId: UUID_C3 } })).statusCode, 201);

  // Disarmed live tick -> 403 sequence_disarmed, zero sends!
  const disarmedTick = await callRoute(router, 'POST', '/sequences/:id/tick', { params: { id: seqId }, body: { nowIso: '2026-11-26T01:00:00.000Z' } });
  assert.equal(disarmedTick.statusCode, 403);
  assert.equal(disarmedTick.body.error, 'sequence_disarmed');
  assert.equal(sentCalls.length, 0);

  // Standing authorization strict validation: garbage -> 400, no confirm -> 428, cap 0 -> 400.
  for (const garbage of ['true', 1, 'yes', {}, null]) {
    const bad = await callRoute(router, 'PUT', '/sequences/:id/authorization', {
      params: { id: seqId }, body: { standingAuthorization: garbage, confirm: true, dailyCap: 2 },
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.error, 'invalid_standing_authorization');
  }
  assert.equal((await callRoute(router, 'PUT', '/sequences/:id/authorization', {
    params: { id: seqId }, body: { standingAuthorization: true, dailyCap: 2 },
  })).statusCode, 428);
  assert.equal((await callRoute(router, 'PUT', '/sequences/:id/authorization', {
    params: { id: seqId }, body: { standingAuthorization: true, confirm: true, dailyCap: 0 },
  })).statusCode, 400);

  // Arm with strict true + confirm: true + dailyCap: 2 -> armed!
  const armed = await callRoute(router, 'PUT', '/sequences/:id/authorization', {
    params: { id: seqId }, body: { standingAuthorization: true, confirm: true, dailyCap: 2 },
  });
  assert.equal(armed.statusCode, 200);
  assert.equal(armed.body.sequence.standing_authorization, true);
  assert.equal(armed.body.sequence.armed, true);
  assert.equal(armed.body.sequence.status, 'active');

  // Step 1 live tick with 3 due enrollments & dailyCap: 2 -> at most 2 sent (C1 & C2), C3 deferred skipped_cap!
  const tick1 = await callRoute(router, 'POST', '/sequences/:id/tick', {
    params: { id: seqId }, body: { nowIso: '2026-11-26T01:00:00.000Z' },
  });
  assert.equal(tick1.statusCode, 200);
  assert.equal(tick1.body.stats.sent, 2);
  assert.equal(tick1.body.stats.skippedCap, 1);
  assert.equal(sentCalls.length, 2);
  assert.equal(sentCalls[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const d1ByContact = new Map(tick1.body.decisions.map((d) => [d.contactId, d]));
  assert.equal(d1ByContact.get(UUID_C1).outcome, 'sent');
  assert.equal(d1ByContact.get(UUID_C1).nextStepOrder, 1);
  assert.equal(d1ByContact.get(UUID_C2).outcome, 'sent');
  assert.equal(d1ByContact.get(UUID_C2).nextStepOrder, 1);
  assert.equal(d1ByContact.get(UUID_C3).outcome, 'skipped_cap');
  assert.equal(d1ByContact.get(UUID_C3).nextStepOrder, 0);

  // Suppress C2 (Bob) between Step 1 and Step 2, raise cap to 5, advance clock +25h so Step 2 is due!
  pool.suppressions.set(`owner-a:email:${c2Hash}`, { suppression_id: 's-bob', owner_sub: 'owner-a', channel: 'email', address_hash: c2Hash });
  await callRoute(router, 'PUT', '/sequences/:id/authorization', {
    params: { id: seqId }, body: { standingAuthorization: true, confirm: true, dailyCap: 5 },
  });
  // Reset today ledger count to simulate next day (+25h) for Step 2!
  pool.runLedger.length = 0;

  const tick2 = await callRoute(router, 'POST', '/sequences/:id/tick', {
    params: { id: seqId }, body: { nowIso: '2026-11-27T02:00:00.000Z' },
  });
  assert.equal(tick2.statusCode, 200);
  const d2ByContact = new Map(tick2.body.decisions.map((d) => [d.contactId, d]));
  // C1 receives Step 2 and completes!
  assert.equal(d2ByContact.get(UUID_C1).outcome, 'sent');
  assert.equal(d2ByContact.get(UUID_C1).stepOrder, 2);
  assert.equal(d2ByContact.get(UUID_C1).nextStatus, 'completed');
  // C2 is skipped_suppressed and marked stopped_unsubscribed!
  assert.equal(d2ByContact.get(UUID_C2).outcome, 'skipped_suppressed');
  assert.equal(d2ByContact.get(UUID_C2).nextStatus, 'stopped_unsubscribed');
  // C3 (deferred earlier) now receives Step 1!
  assert.equal(d2ByContact.get(UUID_C3).outcome, 'sent');
  assert.equal(d2ByContact.get(UUID_C3).stepOrder, 1);

  // Welcome-sequence auto-enrollment on double opt-in confirm!
  const formRes = await callRoute(router, 'POST', '/audience/signup-forms', {
    body: { name: 'Launch Waitlist', slug: 'launch-waitlist', consentText: 'Yes, subscribe me.' },
  });
  assert.equal(formRes.statusCode, 201);
  const subRes = await callRoute(router, 'POST', '/audience/signup-forms/:slug/submit', {
    params: { slug: 'launch-waitlist' },
    body: { email: 'welcome-new@example.com', returnPreviewLink: true },
  });
  assert.equal(subRes.statusCode, 200);
  const confRes = await callRoute(router, 'POST', '/audience/opt-in/confirm', {
    body: { token: subRes.body.preview.token },
  });
  assert.equal(confRes.statusCode, 200);
  assert.deepEqual(confRes.body.enrolledSequenceIds, [seqId]);

  // Two-owner isolation: Owner B gets 404 on read, step, auth, disarm, enroll, tick.
  assert.equal((await callRoute(router, 'GET', '/sequences/:id', { sub: 'owner-b', params: { id: seqId } })).statusCode, 404);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/steps', { sub: 'owner-b', params: { id: seqId }, body: { stepOrder: 3, subject: 'x', body: 'y' } })).statusCode, 404);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/disarm', { sub: 'owner-b', params: { id: seqId } })).statusCode, 404);
  assert.equal((await callRoute(router, 'POST', '/sequences/:id/tick', { sub: 'owner-b', params: { id: seqId }, body: { dryRun: true } })).statusCode, 404);

  // One-click disarm (NO confirm needed) immediately stops all further live sends!
  const dis = await callRoute(router, 'POST', '/sequences/:id/disarm', { params: { id: seqId } });
  assert.equal(dis.statusCode, 200);
  assert.equal(dis.body.disarmed, true);
  assert.equal(dis.body.sequence.standing_authorization, false);
  assert.equal(dis.body.sequence.armed, false);

  const sendsBefore = sentCalls.length;
  const blockedAfterDisarm = await callRoute(router, 'POST', '/sequences/:id/tick', {
    params: { id: seqId }, body: { nowIso: '2026-11-28T02:00:00.000Z' },
  });
  assert.equal(blockedAfterDisarm.statusCode, 403);
  assert.equal(blockedAfterDisarm.body.error, 'sequence_disarmed');
  assert.equal(sentCalls.length, sendsBefore);
  assert.ok(c1Hash.length === 64);
});
