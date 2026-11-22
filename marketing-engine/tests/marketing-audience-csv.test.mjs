/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Unit and compiled route tests for
 *     marketing-engine 0.6.1 P1 CSV import with consent attestation: RFC-4180 parsing (quoted
 *     commas, embedded newlines, escaped quotes, CRLF, UTF-8 BOM, blank lines, malformed
 *     quotes, 1 MiB size cap, 5,000-row cap), atomic refusal on missing consent source (zero
 *     writes), pending-by-default with downgrade of undocumented confirmed claims, confirmed
 *     import with documented prior consent evidence, strict non-resubscription of suppressed
 *     addresses (case/whitespace variants), deterministic CSV deduplication, invalid email
 *     reporting, list ownership checks, and session auth enforcement.
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
const csvMod = require(join(pkgDir, 'routes', 'marketing-audience-csv.js'));

const UUID_LIST = '22222222-2222-4222-8222-222222222222';
const UUID_FOREIGN_LIST = '99999999-9999-4999-8999-999999999999';

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
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE') };
}

/** Invoke POST /audience/contacts/import-csv through the compiled marketing-routes router. */
async function callImport(router, { sub = 'owner-a', body = {}, headers = { 'user-agent': 'CsvTest/1.0' }, ip = '203.0.113.50' } = {}) {
  const entry = router.routes.find((r) => r.method === 'POST' && r.path === '/audience/contacts/import-csv');
  assert.ok(entry, 'POST /audience/contacts/import-csv must be registered');
  const req = { method: 'POST', path: '/audience/contacts/import-csv', params: {}, query: {}, body, headers, ip, oidc: sub ? { user: { sub } } : null };
  const res = {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
  };
  await entry.handler(req, res);
  return res;
}

/** Stateful in-memory pool exercising the exact SQL statements of importContactsCsv. */
function makeMemoryPool({ suppressedEmails = [], ownedLists = [UUID_LIST] } = {}) {
  const calls = [];
  const contacts = new Map();
  const consents = [];
  const listMembers = [];
  const suppressions = suppressedEmails.map((email, idx) => ({
    suppression_id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
    owner_sub: 'owner-a',
    channel: 'email',
    address_hash: model.hashAddress(email),
    reason: 'unsubscribe',
    source: 'manual',
  }));
  let seq = 1;
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM oshal_marketing_lists WHERE list_id = $1 AND owner_sub = $2')) {
      return { rows: ownedLists.includes(params[0]) ? [{ list_id: params[0] }] : [], rowCount: ownedLists.includes(params[0]) ? 1 : 0 };
    }
    if (sql.includes('FROM oshal_marketing_suppressions WHERE owner_sub = $1 AND channel = $2')) {
      const matched = suppressions.filter((s) => s.owner_sub === params[0] && s.channel === params[1]);
      return { rows: matched, rowCount: matched.length };
    }
    if (sql.includes('FROM oshal_marketing_contacts WHERE owner_sub = $1 AND email_hash = $2')) {
      const existing = contacts.get(`${params[0]}:${params[1]}`);
      return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_contacts')) {
      const [ownerSub, email, emailHash, displayName, tagsJson, metaJson] = params;
      const key = `${ownerSub}:${emailHash}`;
      const existing = contacts.get(key);
      const row = {
        contact_id: existing?.contact_id ?? `10000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`,
        owner_sub: ownerSub,
        email,
        email_hash: emailHash,
        display_name: displayName || existing?.display_name || '',
        tags: JSON.parse(tagsJson),
        status: existing?.status === 'suppressed' ? 'suppressed' : 'active',
        metadata: JSON.parse(metaJson),
      };
      contacts.set(key, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_consents')) {
      const [ownerSub, contactId, channel, purpose, status, evidenceJson] = params;
      const row = {
        consent_id: `20000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`,
        owner_sub: ownerSub,
        contact_id: contactId,
        channel,
        purpose,
        status,
        evidence: JSON.parse(evidenceJson),
      };
      consents.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO oshal_marketing_list_members')) {
      listMembers.push({ owner_sub: params[0], list_id: params[1], contact_id: params[2] });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { pool: { query }, calls, contacts, consents, listMembers, suppressions };
}

test('parseRfc4180Csv handles BOM, CRLF, quoted commas, escaped quotes, embedded newlines, blank lines, and caps', () => {
  const csv = '\uFEFFemail,display_name,tags\r\n"alice@example.com","Smith, ""Al"" Alice","beta;vip"\r\n\r\n"bob@example.com","Bob\nLine2","alpha|beta"\r\n';
  const parsed = csvMod.parseRfc4180Csv(csv);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[0], { rowNumber: 1, cells: ['email', 'display_name', 'tags'] });
  assert.deepEqual(parsed.rows[1], { rowNumber: 2, cells: ['alice@example.com', 'Smith, "Al" Alice', 'beta;vip'] });
  assert.deepEqual(parsed.rows[2], { rowNumber: 4, cells: ['bob@example.com', 'Bob\nLine2', 'alpha|beta'] });

  assert.equal(csvMod.parseRfc4180Csv('email\n"unterminated@example.com').error, 'invalid_csv_format');
  assert.equal(csvMod.parseRfc4180Csv('email\na"b@example.com').error, 'invalid_csv_format');
  assert.equal(csvMod.parseRfc4180Csv('a'.repeat(csvMod.MAX_CSV_BYTES + 1)).error, 'csv_too_large');
  const tooManyRows = ['email', ...Array.from({ length: csvMod.MAX_CSV_ROWS + 1 }, (_, i) => `u${i}@example.com`)].join('\n');
  assert.equal(csvMod.parseRfc4180Csv(tooManyRows).error, 'csv_too_many_rows');
});

test('parseAudienceCsv validates email column, strict ISO timestamps, and atomic consent-source requirement', () => {
  assert.equal(csvMod.parseAudienceCsv('name\nAlice', { importBatchId: 'b1', consentSource: 'Booth' }).error, 'email_column_required');
  assert.equal(csvMod.parseStrictIsoTimestamp('2026-11-20T18:30:00Z'), '2026-11-20T18:30:00.000Z');
  assert.equal(csvMod.parseStrictIsoTimestamp('2026-02-30T10:00:00Z'), null);
  assert.equal(csvMod.parseStrictIsoTimestamp('yesterday'), null);

  const missingAll = csvMod.parseAudienceCsv('email,name\nalice@example.com,Alice\nbob@example.com,Bob', { importBatchId: 'b1' });
  assert.equal(missingAll.ok, false);
  assert.equal(missingAll.error, 'consent_source_required');
  assert.deepEqual(missingAll.missingConsentSourceRows, [2, 3]);

  const missingOne = csvMod.parseAudienceCsv(
    'email,consent_source\nalice@example.com,Conference booth\nbob@example.com,\ncarol@example.com,Webinar',
    { importBatchId: 'b1' },
  );
  assert.equal(missingOne.ok, false);
  assert.equal(missingOne.error, 'consent_source_required');
  assert.deepEqual(missingOne.missingConsentSourceRows, [3]);
});

test('POST /audience/contacts/import-csv requires session auth and refuses missing consentSource atomically with zero writes', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const mem = makeMemoryPool();
  const router = routesMod.createMarketingRoutes({ pool: mem.pool, appPackageDir: pkgDir });

  const unauth = await callImport(router, { sub: null, body: { csv: 'email\na@example.com', consentSource: 'Event' } });
  assert.equal(unauth.statusCode, 401);
  assert.equal(mem.calls.length, 0);

  const missingGlobal = await callImport(router, { body: { csv: 'email,name\nalice@example.com,Alice' } });
  assert.equal(missingGlobal.statusCode, 400);
  assert.equal(missingGlobal.body.error, 'consent_source_required');
  assert.deepEqual(missingGlobal.body.missingConsentSourceRows, [2]);
  assert.equal(mem.calls.length, 0);

  const missingOneRow = await callImport(router, {
    body: { csv: 'email,consent_source\nalice@example.com,Webinar Q4\nbob@example.com,' },
  });
  assert.equal(missingOneRow.statusCode, 400);
  assert.equal(missingOneRow.body.error, 'consent_source_required');
  assert.deepEqual(missingOneRow.body.missingConsentSourceRows, [3]);
  assert.equal(mem.contacts.size, 0);
  assert.equal(mem.consents.length, 0);
  assert.equal(mem.calls.length, 0);
});

test('POST /audience/contacts/import-csv enforces pending-by-default, documented prior consent, suppression protection, dedupe, and invalid rows', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const mem = makeMemoryPool({ suppressedEmails: ['suppressed.user@example.com'] });
  const router = routesMod.createMarketingRoutes({ pool: mem.pool, appPackageDir: pkgDir });

  const csv = [
    'email,display_name,tags,consent_source,consent_status,consent_recorded_at,consent_evidence,consent_ip,consent_user_agent,utm_source,utm_medium,utm_campaign,consent_token_hash',
    '"  Suppressed.User@Example.COM ",Suppressed Person,vip,Trade show,confirmed,2026-11-01T12:00:00Z,"Signed booth card",198.51.100.1,BoothApp/1,event,offline,q4,',
    'plain@example.com,"Plain, User","beta;early",,pending,,,,,,,,',
    'unproven@example.com,Unproven User,beta,,confirmed,not-a-timestamp,"Claimed yes without valid time",,,,,,',
    'missing-evidence@example.com,Missing Ev,beta,,confirmed,2026-11-10T09:00:00Z,,,,,,,',
    'proven@example.com,Proven User,"founder|launch",Website form export,confirmed,2026-11-15T14:30:00Z,"Checked marketing opt-in box",198.51.100.9,Mozilla/5.0,newsletter,email,launch-q4,' + 'ab'.repeat(32),
    'PLAIN@example.com,Duplicate Plain,dup,,pending,,,,,,,,',
    'not-an-email,Bad Row,,,,,,,,,',
  ].join('\r\n');

  const res = await callImport(router, {
    body: {
      csv,
      consentSource: 'Q4 trade show list',
      attestation: 'Owner attests every listed contact opted in at Q4 booth or web form.',
      listIds: [UUID_LIST],
      tags: ['imported-q4'],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.consentSource, 'Q4 trade show list');
  assert.equal(res.body.channel, 'email');
  assert.equal(res.body.purpose, 'marketing');
  assert.equal(res.body.totalRows, 7);
  assert.equal(res.body.imported, 4);
  assert.equal(res.body.updated, 0);
  assert.equal(res.body.pending, 3);
  assert.equal(res.body.confirmedWithPriorConsent, 1);
  assert.equal(res.body.downgradedToPending, 2);
  assert.equal(res.body.skippedSuppressed, 1);
  assert.equal(res.body.invalidRows, 1);

  // Suppressed address must have ZERO contact, consent, or list rows and suppression untouched.
  const suppHash = model.hashAddress('suppressed.user@example.com');
  assert.equal(mem.contacts.has(`owner-a:${suppHash}`), false);
  assert.equal(mem.consents.some((c) => c.evidence.rowNumber === 2), false);
  assert.equal(mem.suppressions.length, 1);
  assert.equal(mem.suppressions[0].address_hash, suppHash);
  assert.ok(res.body.skipped.some((s) => s.reason === 'suppressed' && s.emailHash === suppHash));
  assert.ok(res.body.skipped.some((s) => s.reason === 'duplicate_in_csv' && s.email === 'plain@example.com'));
  assert.ok(res.body.skipped.some((s) => s.reason === 'invalid_email' && s.rawEmail === 'not-an-email'));

  // Plain row -> pending with import-level consentSource.
  const plainConsent = mem.consents.find((c) => c.evidence.rowNumber === 3);
  assert.equal(plainConsent.status, 'pending');
  assert.equal(plainConsent.evidence.consentSource, 'Q4 trade show list');
  assert.equal(plainConsent.evidence.priorConsentDocumented, false);
  assert.equal(plainConsent.evidence.attestation, 'Owner attests every listed contact opted in at Q4 booth or web form.');
  assert.equal(plainConsent.evidence.importBatchId, res.body.importBatchId);

  // Downgraded rows -> strictly pending with requestedStatus = confirmed.
  const unprovenConsent = mem.consents.find((c) => c.evidence.rowNumber === 4);
  assert.equal(unprovenConsent.status, 'pending');
  assert.equal(unprovenConsent.evidence.priorConsentDocumented, false);
  assert.equal(unprovenConsent.evidence.requestedStatus, 'confirmed');
  const missingEvConsent = mem.consents.find((c) => c.evidence.rowNumber === 5);
  assert.equal(missingEvConsent.status, 'pending');
  assert.equal(missingEvConsent.evidence.priorConsentDocumented, false);
  assert.equal(missingEvConsent.evidence.requestedStatus, 'confirmed');

  // Documented prior consent -> confirmed with full evidence preserved.
  const provenConsent = mem.consents.find((c) => c.evidence.rowNumber === 6);
  assert.equal(provenConsent.status, 'confirmed');
  assert.equal(provenConsent.evidence.consentSource, 'Website form export');
  assert.equal(provenConsent.evidence.priorConsentDocumented, true);
  assert.equal(provenConsent.evidence.formText, 'Checked marketing opt-in box');
  assert.equal(provenConsent.evidence.recordedAt, '2026-11-15T14:30:00.000Z');
  assert.equal(provenConsent.evidence.ip, '198.51.100.9');
  assert.equal(provenConsent.evidence.userAgent, 'Mozilla/5.0');
  assert.deepEqual(provenConsent.evidence.utm, { source: 'newsletter', medium: 'email', campaign: 'launch-q4' });
  assert.equal(provenConsent.evidence.tokenHash, 'ab'.repeat(32));
  assert.equal(mem.listMembers.length, 4);
});

test('POST /audience/contacts/import-csv refuses unknown/foreign listIds and invalid channel with zero writes', async () => {
  const routesMod = loadCompiledModule('routes/marketing-routes.js');
  const mem = makeMemoryPool({ ownedLists: [UUID_LIST] });
  const router = routesMod.createMarketingRoutes({ pool: mem.pool, appPackageDir: pkgDir });

  const badChan = await callImport(router, {
    body: { csv: 'email\nalice@example.com', consentSource: 'Booth', channel: 'fax' },
  });
  assert.equal(badChan.statusCode, 400);
  assert.equal(badChan.body.error, 'invalid_channel');

  const badListId = await callImport(router, {
    body: { csv: 'email\nalice@example.com', consentSource: 'Booth', listIds: ['not-a-uuid'] },
  });
  assert.equal(badListId.statusCode, 400);
  assert.equal(badListId.body.error, 'invalid_list_id');

  const foreignList = await callImport(router, {
    body: { csv: 'email\nalice@example.com', consentSource: 'Booth', listIds: [UUID_FOREIGN_LIST] },
  });
  assert.equal(foreignList.statusCode, 404);
  assert.equal(foreignList.body.error, 'list_not_found');
  assert.equal(foreignList.body.listId, UUID_FOREIGN_LIST);
  assert.equal(mem.contacts.size, 0);
  assert.equal(mem.consents.length, 0);
});
