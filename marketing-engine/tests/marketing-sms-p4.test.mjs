/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit and compiled-handler tests for
 *     marketing-engine 0.6.10 P4 SMS TCPA/CTIA consent evidence, E.164 phone normalization,
 *     NANP area-code timezone inference vs explicit IANA timezone, clock-controlled DST-aware
 *     quiet-hours holding (10 p.m. local held until next 8 a.m. local in America/New_York and
 *     America/Los_Angeles; 10 a.m. local allowed), consent refusal for unconsented contacts,
 *     CTIA STOP/HELP keyword handling (suppression, revocation, held-queue cancellation), and
 *     two-owner 404 isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const smsModel = require(join(pkgDir, 'routes', 'marketing-sms-model.js'));
const audModel = require(join(pkgDir, 'routes', 'marketing-audience-model.js'));

const VALID_EVIDENCE = {
  programName: 'Open Swarm Alerts',
  disclosureText: 'I agree to receive recurring automated SMS alerts from Open Swarm. Consent is not required to buy.',
  frequency: 'Up to 4 msgs/month',
  helpText: 'Reply HELP for support',
  stopText: 'Reply STOP to cancel',
  feeDisclosure: 'Msg & data rates may apply',
  recordedAt: '2026-11-25T18:00:00.000Z',
};

/** Load compiled marketing-sms handlers with minimal runtime stubs. */
function loadCompiledSms(relPath = 'routes/marketing-sms.js') {
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
    '@/app/connectors/runtime': { loadConnectorSpec: () => null },
  };
  const cache = new Map();
  const reqStub = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith('./')) {
      const target = join(dirname(full), id.endsWith('.js') ? id : `${id}.js`);
      if (!cache.has(target)) cache.set(target, loadCompiledSms(target.slice(pkgDir.length + 1)));
      return cache.get(target);
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', src)(
    reqStub, mod, mod.exports, full, dirname(full),
  );
  return mod.exports;
}

function makeRouter() {
  const routes = [];
  const add = (method) => (routePath, ...handlers) => {
    routes.push({ method, path: routePath, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

/** Stateful in-memory PostgreSQL stub for marketing-sms route tests with owner scoping. */
function makeMemoryPool() {
  let seq = 1;
  const nextUuid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;
  const state = { contacts: [], consents: [], suppressions: [], queue: [], compliance: new Map() };

  const query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM oshal_marketing_compliance_settings')) {
      const row = state.compliance.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (s.startsWith('SELECT suppression_id FROM oshal_marketing_suppressions')) {
      const found = state.suppressions.filter((r) => r.owner_sub === params[0] && r.channel === 'sms' && r.address_hash === params[1]);
      return { rows: found, rowCount: found.length };
    }
    if (s.startsWith('INSERT INTO oshal_marketing_suppressions')) {
      const [owner_sub, address_hash] = params;
      let existing = state.suppressions.find((r) => r.owner_sub === owner_sub && r.channel === 'sms' && r.address_hash === address_hash);
      if (!existing) {
        existing = { suppression_id: nextUuid(), owner_sub, channel: 'sms', address_hash, reason: 'sms_stop_keyword', source: 'sms_keyword' };
        state.suppressions.push(existing);
      }
      return { rows: [existing], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO oshal_marketing_contacts')) {
      const [owner_sub, email, email_hash, display_name, tagsJson, phone_e164, phone_hash, timezone, timezone_inferred] = params;
      let row = state.contacts.find((c) => c.owner_sub === owner_sub && c.email_hash === email_hash);
      if (row) {
        Object.assign(row, { phone_e164, phone_hash, timezone, timezone_inferred });
      } else {
        row = {
          contact_id: nextUuid(), owner_sub, email, email_hash, display_name,
          tags: JSON.parse(tagsJson), status: 'active', phone_e164, phone_hash, timezone, timezone_inferred,
        };
        state.contacts.push(row);
      }
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith('UPDATE oshal_marketing_contacts SET phone_e164')) {
      const [phone_e164, phone_hash, timezone, timezone_inferred, contact_id, owner_sub] = params;
      const row = state.contacts.find((c) => c.contact_id === contact_id && c.owner_sub === owner_sub);
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, { phone_e164, phone_hash, timezone, timezone_inferred });
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith('SELECT * FROM oshal_marketing_contacts WHERE contact_id = $1 AND owner_sub = $2')) {
      const found = state.contacts.filter((c) => c.contact_id === params[0] && c.owner_sub === params[1]);
      return { rows: found, rowCount: found.length };
    }
    if (s.startsWith('SELECT contact_id, phone_e164, phone_hash FROM oshal_marketing_contacts')) {
      const found = state.contacts.filter((c) => c.contact_id === params[0] && c.owner_sub === params[1]);
      return { rows: found, rowCount: found.length };
    }
    if (s.startsWith('SELECT contact_id FROM oshal_marketing_contacts WHERE owner_sub = $1 AND phone_hash = $2')) {
      const found = state.contacts.filter((c) => c.owner_sub === params[0] && c.phone_hash === params[1]);
      return { rows: found, rowCount: found.length };
    }
    if (s.startsWith('INSERT INTO oshal_marketing_consents')) {
      const [owner_sub, contact_id, purpose, evidenceJson] = params;
      const row = {
        consent_id: nextUuid(), owner_sub, contact_id, channel: 'sms', purpose,
        status: 'confirmed', evidence: JSON.parse(evidenceJson), created_at: new Date().toISOString(),
      };
      state.consents.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith('SELECT * FROM oshal_marketing_consents WHERE owner_sub = $1 AND contact_id = $2')) {
      const found = state.consents.filter((c) => c.owner_sub === params[0] && c.contact_id === params[1] && c.channel === 'sms').reverse();
      return { rows: found.slice(0, 1), rowCount: Math.min(1, found.length) };
    }
    if (s.startsWith('UPDATE oshal_marketing_consents SET status = \'revoked\'')) {
      let count = 0;
      for (const c of state.consents) {
        if (c.owner_sub === params[0] && c.contact_id === params[1] && c.channel === 'sms' && c.status !== 'revoked') {
          c.status = 'revoked';
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (s.startsWith('INSERT INTO oshal_marketing_sms_queue')) {
      const [owner_sub, contact_id, phone_hash, body, recipient_timezone, timezone_inferred, status, gate_reason, scheduled_for, release_at] = params;
      const row = {
        sms_id: nextUuid(), owner_sub, contact_id, phone_hash, body, recipient_timezone,
        timezone_inferred, status, gate_reason, scheduled_for, release_at, created_at: new Date().toISOString(),
      };
      state.queue.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith('UPDATE oshal_marketing_sms_queue SET status = \'cancelled\'')) {
      let count = 0;
      for (const q of state.queue) {
        if (q.owner_sub === params[0] && q.contact_id === params[1] && q.status === 'held_quiet_hours') {
          q.status = 'cancelled';
          q.gate_reason = 'cancelled_by_stop';
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (s.startsWith('SELECT q.*, c.email, c.display_name, c.phone_e164 FROM oshal_marketing_sms_queue')) {
      const owner_sub = params[0];
      const joined = state.queue
        .filter((q) => q.owner_sub === owner_sub)
        .map((q) => {
          const c = state.contacts.find((x) => x.contact_id === q.contact_id && x.owner_sub === owner_sub);
          return c ? { ...q, email: c.email, display_name: c.display_name, phone_e164: c.phone_e164 } : null;
        })
        .filter(Boolean)
        .reverse();
      return { rows: joined, rowCount: joined.length };
    }
    return { rows: [], rowCount: 0 };
  };
  return { pool: { query }, state };
}

async function callHandler(fn, pool, sub, { body = {}, query = {}, params = {}, headers = {}, ip = '198.51.100.20' } = {}) {
  const req = { body, query, params, headers, ip, oidc: sub ? { user: { sub } } : null };
  const res = {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
  await fn({ pool }, sub, req, res);
  return res;
}

test('normalizePhoneE164 accepts strict E.164 and formatted US/CA numbers and rejects invalid inputs', () => {
  assert.equal(smsModel.normalizePhoneE164('+14155550199'), '+14155550199');
  assert.equal(smsModel.normalizePhoneE164('(415) 555-0199'), '+14155550199');
  assert.equal(smsModel.normalizePhoneE164('1-212-555-0144'), '+12125550144');
  assert.equal(smsModel.normalizePhoneE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(smsModel.normalizePhoneE164('+0123456789'), null);
  assert.equal(smsModel.normalizePhoneE164('555-1234'), null);
  assert.equal(smsModel.normalizePhoneE164('not-a-phone'), null);
  assert.equal(smsModel.normalizePhoneE164('+12345678901234567'), null);
  assert.equal(smsModel.normalizePhoneE164(''), null);
});

test('inferTimezoneFromPhone maps NANP area codes with inferred: true and explicit IANA timezone returns inferred: false', () => {
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+12125550100'), { timezone: 'America/New_York', inferred: true, areaCode: '212' });
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+18505550100'), { timezone: 'America/Chicago', inferred: true, areaCode: '850' });
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+13035550100'), { timezone: 'America/Denver', inferred: true, areaCode: '303' });
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+14155550199'), { timezone: 'America/Los_Angeles', inferred: true, areaCode: '415' });
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+19075550100'), { timezone: 'America/Anchorage', inferred: true, areaCode: '907' });
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+18085550100'), { timezone: 'Pacific/Honolulu', inferred: true, areaCode: '808' });
  assert.deepEqual(smsModel.inferTimezoneFromPhone('+442079460958', 'America/Chicago'), { timezone: 'America/Chicago', inferred: true, areaCode: null });

  assert.deepEqual(
    smsModel.resolveRecipientTimezone({ explicitTimezone: 'Europe/London', phoneE164: '+14155550199' }),
    { ok: true, timezone: 'Europe/London', inferred: false },
  );
  assert.deepEqual(
    smsModel.resolveRecipientTimezone({ explicitTimezone: 'Mars/Olympus_Mons', phoneE164: '+14155550199' }),
    { ok: false, error: 'invalid_timezone' },
  );
});

test('TCPA/CTIA consent evidence requires all 7 fields and builds deterministic confirmation text', () => {
  const ok = smsModel.normalizeSmsConsentEvidence(VALID_EVIDENCE);
  assert.equal(ok.ok, true);
  assert.equal(smsModel.hasValidSmsConsent({ channel: 'sms', status: 'confirmed', evidence: ok.evidence }), true);
  assert.equal(smsModel.hasValidSmsConsent({ channel: 'email', status: 'confirmed', evidence: ok.evidence }), false);
  assert.equal(smsModel.hasValidSmsConsent({ channel: 'sms', status: 'pending', evidence: ok.evidence }), false);

  const confirmText = smsModel.buildSmsOptInConfirmationText(ok.evidence);
  assert.match(confirmText, /Open Swarm Alerts/);
  assert.match(confirmText, /Up to 4 msgs\/month/);
  assert.match(confirmText, /Msg & data rates may apply/);
  assert.match(confirmText, /HELP/);
  assert.match(confirmText, /STOP/);

  for (const field of ['programName', 'disclosureText', 'frequency', 'helpText', 'stopText', 'feeDisclosure', 'recordedAt']) {
    const partial = { ...VALID_EVIDENCE };
    delete partial[field];
    const res = smsModel.normalizeSmsConsentEvidence(partial);
    assert.equal(res.ok, false, `omitting ${field} must refuse`);
    assert.equal(res.error, 'sms_consent_incomplete');
    assert.ok(res.missingFields.includes(field), `missingFields must include ${field}`);
    assert.equal(smsModel.hasValidSmsConsent({ channel: 'sms', status: 'confirmed', evidence: partial }), false);
  }
  const badHelp = smsModel.normalizeSmsConsentEvidence({ ...VALID_EVIDENCE, helpText: 'Contact support anytime' });
  assert.equal(badHelp.ok, false);
  assert.ok(badHelp.missingFields.includes('helpText'));
  const badStop = smsModel.normalizeSmsConsentEvidence({ ...VALID_EVIDENCE, stopText: 'Opt out anytime' });
  assert.equal(badStop.ok, false);
  assert.ok(badStop.missingFields.includes('stopText'));
});

test('clock-controlled DST-aware quiet hours: 10 p.m. local is held until exact 08:00 local while 10 a.m. local is allowed', () => {
  // Winter EST (UTC-5): 2026-11-25 22:00 EST == 2026-11-26T03:00:00Z -> release 2026-11-26 08:00 EST == 2026-11-26T13:00:00.000Z
  const nyNightWinter = smsModel.evaluateSmsQuietHours('2026-11-26T03:00:00Z', 'America/New_York');
  assert.equal(nyNightWinter.allowed, false);
  assert.equal(nyNightWinter.held, true);
  assert.equal(nyNightWinter.localHour, 22);
  assert.equal(nyNightWinter.localTimeLabel, '22:00');
  assert.equal(nyNightWinter.releaseAtIso, '2026-11-26T13:00:00.000Z');

  // Summer EDT (UTC-4): 2026-07-15 22:00 EDT == 2026-07-16T02:00:00Z -> release 2026-07-16 08:00 EDT == 2026-07-16T12:00:00.000Z
  const nyNightSummer = smsModel.evaluateSmsQuietHours('2026-07-16T02:00:00Z', 'America/New_York');
  assert.equal(nyNightSummer.held, true);
  assert.equal(nyNightSummer.localHour, 22);
  assert.equal(nyNightSummer.releaseAtIso, '2026-07-16T12:00:00.000Z');

  // DST spring-forward night (2026-03-07 22:00 EST == 2026-03-08T03:00:00Z -> 2026-03-08 08:00 EDT == 2026-03-08T12:00:00.000Z)
  const nyDstJump = smsModel.evaluateSmsQuietHours('2026-03-08T03:00:00Z', 'America/New_York');
  assert.equal(nyDstJump.held, true);
  assert.equal(nyDstJump.releaseAtIso, '2026-03-08T12:00:00.000Z');

  // Pacific PST (UTC-8): 2026-11-25 22:00 PST == 2026-11-26T06:00:00Z -> release 2026-11-26 08:00 PST == 2026-11-26T16:00:00.000Z
  const laNight = smsModel.evaluateSmsQuietHours('2026-11-26T06:00:00Z', 'America/Los_Angeles');
  assert.equal(laNight.allowed, false);
  assert.equal(laNight.held, true);
  assert.equal(laNight.localHour, 22);
  assert.equal(laNight.releaseAtIso, '2026-11-26T16:00:00.000Z');

  // Early morning 06:30 PST (2026-11-26T14:30:00Z) -> release SAME morning 08:00 PST (2026-11-26T16:00:00.000Z)
  const laEarly = smsModel.evaluateSmsQuietHours('2026-11-26T14:30:00Z', 'America/Los_Angeles');
  assert.equal(laEarly.held, true);
  assert.equal(laEarly.localHour, 6);
  assert.equal(laEarly.releaseAtIso, '2026-11-26T16:00:00.000Z');

  // 10:00 a.m. local -> allowed!
  const nyDay = smsModel.evaluateSmsQuietHours('2026-11-26T15:00:00Z', 'America/New_York');
  assert.equal(nyDay.allowed, true);
  assert.equal(nyDay.held, false);
  assert.equal(nyDay.localHour, 10);
  const laDay = smsModel.evaluateSmsQuietHours('2026-11-26T18:00:00Z', 'America/Los_Angeles');
  assert.equal(laDay.allowed, true);
  assert.equal(laDay.held, false);
  assert.equal(laDay.localHour, 10);
});

test('classifyInboundSmsKeyword handles CTIA STOP family and HELP family case-insensitively', () => {
  for (const word of ['STOP', 'stop', '  StopAll ', 'Unsubscribe!', 'cancel', 'END', 'quit.']) {
    const res = smsModel.classifyInboundSmsKeyword(word, 'Open Swarm Alerts');
    assert.equal(res.action, 'stop', word);
    assert.equal(res.suppress, true, word);
    assert.match(res.replyText, /unsubscribed/i);
  }
  for (const word of ['HELP', 'help', '  info ']) {
    const res = smsModel.classifyInboundSmsKeyword(word, 'Open Swarm Alerts');
    assert.equal(res.action, 'help', word);
    assert.equal(res.suppress, false, word);
    assert.match(res.replyText, /STOP/);
  }
  assert.equal(smsModel.classifyInboundSmsKeyword('Thanks!').action, 'none');
});

test('compiled SMS routes enforce TCPA/CTIA opt-in, unconsented refusal, quiet-hours hold, STOP cancellation, HELP non-suppression, and two-owner 404 isolation', async () => {
  const sms = loadCompiledSms();
  const { pool, state } = makeMemoryPool();

  // Seed an unconsented contact for owner-a -> schedule refused 403 sms_consent_required!
  const bareContactId = '11111111-1111-4111-8111-111111111111';
  state.contacts.push({
    contact_id: bareContactId, owner_sub: 'owner-a', email: 'noconsent@example.com',
    email_hash: audModel.hashAddress('noconsent@example.com'), display_name: 'No Consent',
    tags: [], status: 'active', phone_e164: '+12125550199', phone_hash: audModel.hashAddress('+12125550199'),
    timezone: 'America/New_York', timezone_inferred: true,
  });
  const unconsented = await callHandler(sms.scheduleSmsMessage, pool, 'owner-a', {
    body: { contactId: bareContactId, body: 'Promo text', nowIso: '2026-11-26T15:00:00Z' },
  });
  assert.equal(unconsented.statusCode, 403);
  assert.equal(unconsented.body.error, 'sms_consent_required');
  assert.equal(unconsented.body.status, 'refused_consent');

  // Incomplete TCPA opt-in refused 400!
  const badOptIn = await callHandler(sms.recordSmsOptIn, pool, 'owner-a', {
    body: { email: 'incomplete@example.com', phoneE164: '+14155550199', programName: 'Open Swarm Alerts' },
  });
  assert.equal(badOptIn.statusCode, 400);
  assert.equal(badOptIn.body.error, 'sms_consent_incomplete');
  assert.ok(badOptIn.body.missingFields.includes('disclosureText'));

  // Valid TCPA opt-in with inferred timezone (415 -> America/Los_Angeles).
  const optIn = await callHandler(sms.recordSmsOptIn, pool, 'owner-a', {
    body: { email: 'consented@example.com', displayName: 'Alex', phone: '(415) 555-0199', ...VALID_EVIDENCE },
  });
  assert.equal(optIn.statusCode, 201);
  assert.equal(optIn.body.timezone, 'America/Los_Angeles');
  assert.equal(optIn.body.timezoneInferred, true);
  assert.match(optIn.body.confirmationText, /Open Swarm Alerts/);
  const contactId = optIn.body.contact.contact_id;

  // Schedule at 10 p.m. Pacific -> 202 held_quiet_hours until 8 a.m. Pacific!
  const held = await callHandler(sms.scheduleSmsMessage, pool, 'owner-a', {
    body: { contactId, body: 'Evening text', nowIso: '2026-11-26T06:00:00Z' },
  });
  assert.equal(held.statusCode, 202);
  assert.equal(held.body.status, 'held_quiet_hours');
  assert.equal(held.body.releaseAt, '2026-11-26T16:00:00.000Z');

  // Schedule at 10 a.m. Pacific -> 200 ready!
  const ready = await callHandler(sms.scheduleSmsMessage, pool, 'owner-a', {
    body: { contactId, body: 'Morning text', nowIso: '2026-11-26T18:00:00Z' },
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.body.status, 'ready');

  // HELP keyword returns support text without suppressing or cancelling.
  const help = await callHandler(sms.processSmsKeyword, pool, 'owner-a', {
    body: { contactId, body: 'help' },
  });
  assert.equal(help.statusCode, 200);
  assert.equal(help.body.action, 'help');
  assert.equal(help.body.suppressed, false);
  assert.equal(help.body.cancelledQueueItems, 0);
  assert.match(help.body.replyText, /STOP/);

  // Two-owner isolation: owner-b gets 404 on owner-a's contact and 0 queue items.
  assert.equal((await callHandler(sms.scheduleSmsMessage, pool, 'owner-b', { body: { contactId, body: 'Cross-owner' } })).statusCode, 404);
  assert.equal((await callHandler(sms.processSmsKeyword, pool, 'owner-b', { body: { contactId, body: 'STOP' } })).statusCode, 404);
  assert.equal((await callHandler(sms.listSmsQueue, pool, 'owner-b', {})).body.items.length, 0);

  // STOP suppresses phone hash, revokes consent, cancels held queue item, and blocks future sends (403).
  const stop = await callHandler(sms.processSmsKeyword, pool, 'owner-a', {
    body: { contactId, body: 'STOP' },
  });
  assert.equal(stop.statusCode, 200);
  assert.equal(stop.body.suppressed, true);
  assert.equal(stop.body.revokedConsents, 1);
  assert.equal(stop.body.cancelledQueueItems, 1);

  const blockedAfterStop = await callHandler(sms.scheduleSmsMessage, pool, 'owner-a', {
    body: { contactId, body: 'Should be refused', nowIso: '2026-11-26T18:00:00Z' },
  });
  assert.equal(blockedAfterStop.statusCode, 403);
  assert.equal(blockedAfterStop.body.error, 'sms_suppressed');

  // Queue read for owner-a contains the recorded decisions including cancelled & refused_suppressed.
  const queueA = await callHandler(sms.listSmsQueue, pool, 'owner-a', {});
  assert.equal(queueA.statusCode, 200);
  assert.ok(queueA.body.items.some((i) => i.status === 'cancelled'));
  assert.ok(queueA.body.items.some((i) => i.status === 'refused_suppressed'));
});
