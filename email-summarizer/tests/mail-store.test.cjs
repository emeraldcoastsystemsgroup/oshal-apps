/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The stored mail copy on a disposable PostgreSQL with the declared migration and forced owner row security (Roger, 2026-10-29: the concierge should search a stored copy of the mail): a first pass stores the last week and then older mail, a pass that hits its deadline keeps its progress and the next one finishes, a duplicate is skipped, a failed Gmail read is recorded and rethrown, a search finds "ACT prep" by word start (not inside "contact"), handles OR and newer_than, falls back to the closest matches, and one person never reads another's copy. Through the compiled routes: GET /messages answers from a current copy (source stored) and from Gmail when the copy is stale (source live); POST /sync stores the caller's mail; GET /sync/status reports it. The SQL holds no ON CONFLICT, ORDER BY or DISTINCT (the native kernel copied a whole table for those).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A pass resumes where the last stopped: after a pass that ran out of time the next one asks Gmail only for mail older than the copy (before:) and newer than it (after:), never refetching or re-reading what is stored (Roger's first live passes stalled: 290, then 73 more). A state written by the old passes (no newest_at) resumes from its last run. GET /messages answers from a copy still filling only over a window the copy reaches.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const { Pool, Client } = require(path.join(TOOLCHAIN, 'pg'));
const DSN = process.env.OSHAL_TEST_POSTGRES;
if (!DSN) throw new Error('OSHAL_TEST_POSTGRES must name the disposable PostgreSQL server for this suite');

const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/skill-profiles': { resolveSkillProfileByApp: () => null, composeSkillProfilePrompt: (p) => p },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'summary' }) },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}), summarizeGmailMetadata: () => ({}) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const store = require('../routes/mail-store.js');
const { createEmailRoutes } = require('../routes/email-app-routes.js');
test.after(() => { Module._load = original; });

const DAY = 24 * 3600 * 1000;
const NOW = Date.now();

/** A disposable database with the declared migration, and one pool per person under forced row security. */
async function database(t) {
  const name = 'mail_store_' + crypto.randomBytes(6).toString('hex');
  const role = name + '_rt';
  const admin = new Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(DSN); url.pathname = '/' + name;
  const owner = new Pool({ connectionString: url.toString(), max: 2 });
  await owner.query(fs.readFileSync(path.join(PKG, 'migrations', '001-email-mail-store.sql'), 'utf8'));
  await owner.query(fs.readFileSync(path.join(PKG, 'migrations', '001-email-mail-store.sql'), 'utf8')); // idempotent
  await owner.query(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN; GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT, INSERT, UPDATE, DELETE ON oshal_email_messages, oshal_email_sync TO ${role}; GRANT ${role} TO CURRENT_USER`);
  const as = (sub) => new Pool({ connectionString: url.toString(), max: 2, options: `-c role=${role} -c oshal.current_sub=${sub}` });
  const pools = { alice: as('alice'), bob: as('bob') };
  t.after(async () => {
    for (const p of [owner, pools.alice, pools.bob]) await p.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });
  return { owner, ...pools };
}

/** A Gmail mailbox for the reader: messages (id, subject, from, snippet, at) answering `after:`/`before:` searches. */
function gmail(messages, { pageSize = 2, failOn } = {}) {
  const calls = { list: [], metadata: [] };
  const reader = {
    list: async (q, token) => {
      calls.list.push(q);
      const after = Number((/after:(\d+)/.exec(q) || [])[1] || 0) * 1000;
      const before = Number((/before:(\d+)/.exec(q) || [])[1] || Infinity) * 1000;
      const hits = messages.filter((m) => m.at > after && m.at < before).sort((a, b) => b.at - a.at).map((m) => m.id);
      const start = Number(token || 0);
      return { ids: hits.slice(start, start + pageSize), next: start + pageSize < hits.length ? String(start + pageSize) : undefined };
    },
    metadata: async (id) => {
      calls.metadata.push(id);
      if (failOn === id) throw new Error('google 503: backend error');
      const m = messages.find((x) => x.id === id);
      return { id, snippet: m.snippet || '', labelIds: m.labels || ['INBOX'], internalDate: String(m.at),
        payload: { headers: [{ name: 'From', value: m.from || 'Someone <s@example.com>' }, { name: 'Subject', value: m.subject }] } };
    },
  };
  return { reader, calls };
}

const MAIL = [
  { id: 'act', subject: 'Fall ACT prep course: 20% off', from: 'Prep Academy <offers@prep.example>', snippet: 'Enroll by Friday', at: NOW - 1 * DAY },
  { id: 'contact', subject: 'Update your contact details', from: 'Bank <no-reply@bank.example>', snippet: 'Please review', at: NOW - 2 * DAY },
  { id: 'sat', subject: 'SAT practice test this Saturday', from: 'School <news@school.example>', snippet: 'Bring a calculator', at: NOW - 3 * DAY },
  { id: 'old', subject: 'ACT preparation workbook shipped', from: 'Books <ship@books.example>', snippet: 'Tracking inside', at: NOW - 40 * DAY },
  { id: 'ancient', subject: 'ACT prep from long ago', from: 'Old <old@example.com>', snippet: '', at: NOW - 400 * DAY },
];

test('a first pass stores mail newest first back to the window, and a later pass only adds new mail', async (t) => {
  const db = await database(t);
  const box = gmail(MAIL);
  const first = await store.syncGmail(db.alice, 'alice', box.reader, Date.now() + 10_000, NOW);
  assert.equal(first.inserted, 4, 'everything inside 180 days; the 400-day-old message is outside the window');
  assert.equal(first.complete, true);
  assert.ok(box.calls.list.every((q) => /^after:\d+ -in:chats -in:drafts$/.test(q)), 'one walk from the newest message down to the window');
  const later = gmail([...MAIL, { id: 'new', subject: 'Your ACT score report', at: NOW + 60_000 }]);
  const second = await store.syncGmail(db.alice, 'alice', later.reader, Date.now() + 10_000, NOW + 120_000);
  assert.equal(second.inserted, 1);
  assert.deepEqual(later.calls.metadata, ['new'], 'stored messages are not fetched again');
  assert.ok(later.calls.list.every((q) => /^after:\d+ -in:chats -in:drafts$/.test(q)) && later.calls.list.length === 1, 'a complete copy only asks for new mail');
  const state = await store.readStoreState(db.alice, 'alice');
  assert.equal(state.stored, 5);
  assert.equal(state.complete, true);
  assert.equal(store.storeIsFresh(state, Date.now()), true);
  assert.equal(store.storeIsFresh(state, Date.now() + 31 * 60_000), false, 'a copy no pass has refreshed for 30 minutes is not used');
});

test('a pass that reaches its deadline keeps what it stored and the next pass finishes', async (t) => {
  const db = await database(t);
  const box = gmail(MAIL);
  let deadline = Date.now() + 10_000;
  // The clock runs out after the second message: the deadline is read at each step, as Date.now() would pass it.
  const reader = { list: box.reader.list, metadata: async (id) => { const m = await box.reader.metadata(id); if (box.calls.metadata.length >= 2) deadline = 0; return m; } };
  const partial = await store.syncGmail(db.alice, 'alice', reader, { valueOf: () => deadline }, NOW);
  assert.equal(partial.inserted, 2);
  assert.equal(partial.complete, false);
  const filling = await store.readStoreState(db.alice, 'alice');
  assert.equal(filling.oldestAt, new Date(NOW - 2 * DAY).toISOString(), 'the copy reaches the second message');
  assert.equal(store.storeCovers(filling, 1, NOW), true, 'a 1-day search is answered from the copy');
  assert.equal(store.storeCovers(filling, 30, NOW), false, 'a 30-day search is not: the copy does not reach back that far');
  const next = gmail(MAIL);
  const rest = await store.syncGmail(db.alice, 'alice', next.reader, Date.now() + 10_000, NOW + 60_000);
  assert.equal(rest.inserted, 2);
  assert.deepEqual(next.calls.metadata, ['sat', 'old'], 'the next pass fetches only what is not stored');
  assert.ok(Number(/after:(\d+)/.exec(next.calls.list[0])[1]) * 1000 >= NOW - 11 * 60_000, 'it first asks only for mail newer than the copy, not the stored week again');
  assert.ok(next.calls.list.some((q) => /^before:\d+ after:\d+ /.test(q)), 'it continues below the copy');
  const done = await store.readStoreState(db.alice, 'alice');
  assert.equal(done.stored, 4);
  assert.equal(done.complete, true);
});

test('a state written by the passes that did not resume picks up from its last run', async (t) => {
  const db = await database(t);
  // What Roger's first live passes left: no newest_at, oldest_at at the third message, last run an hour ago.
  for (const m of MAIL.slice(0, 2)) await db.alice.query(`INSERT INTO oshal_email_messages (msg_key, user_sub, provider, message_id, subject, received_at) VALUES ($1, 'alice', 'google', $2, $3, $4)`, [`alice|google|${m.id}`, m.id, m.subject, new Date(m.at).toISOString()]);
  await db.alice.query(`INSERT INTO oshal_email_sync (sync_key, user_sub, provider, oldest_at, stored, last_run_at) VALUES ('alice|google', 'alice', 'google', $1, 2, $2)`, [new Date(NOW - 2 * DAY).toISOString(), new Date(NOW - 3600_000).toISOString()]);
  const box = gmail([...MAIL, { id: 'new', subject: 'Arrived since', at: NOW - 60_000 }]);
  const pass = await store.syncGmail(db.alice, 'alice', box.reader, Date.now() + 10_000, NOW);
  assert.deepEqual(box.calls.metadata.sort(), ['new', 'old', 'sat'], 'new mail since the last run, then the older mail, and nothing already stored');
  assert.ok(Number(/after:(\d+)/.exec(box.calls.list[0])[1]) * 1000 >= NOW - 3600_000 - 11 * 60_000, 'it starts from its last run, not from the top of the mailbox');
  assert.equal(pass.complete, true);
  assert.equal((await store.readStoreState(db.alice, 'alice')).stored, 5);
});

test('a failed Gmail read keeps the stored mail, records the failure and is reported', async (t) => {
  const db = await database(t);
  await assert.rejects(store.syncGmail(db.alice, 'alice', gmail(MAIL, { failOn: 'sat' }).reader, Date.now() + 10_000, NOW), /google 503/);
  const state = await store.readStoreState(db.alice, 'alice');
  assert.equal(state.stored, 2, 'the two newer messages stayed');
  assert.match(state.lastError, /google 503/);
  assert.equal(store.storeIsFresh(state), false);
});

test('a search finds words at word starts, honours OR and newer_than, and falls back to the closest matches', async (t) => {
  const db = await database(t);
  await store.syncGmail(db.alice, 'alice', gmail(MAIL).reader, Date.now() + 10_000, NOW);
  const ids = (r) => r.messages.map((m) => m.id);
  const offer = await store.searchStored(db.alice, 'alice', 2, 25, 'an offer for ACT prep', NOW);
  assert.deepEqual(ids(offer), ['act'], '"act" is not found inside "contact"; filler words are ignored; "offer" finds "offers@"');
  assert.equal(offer.matchedAll, true);
  const discount = await store.searchStored(db.alice, 'alice', 2, 25, 'a discount for ACT prep', NOW);
  assert.deepEqual(ids(discount), ['act']);
  assert.equal(discount.matchedAll, false, 'no message holds "discount" too: the closest match is returned and marked');
  assert.deepEqual(ids(await store.searchStored(db.alice, 'alice', 2, 25, 'ACT prep', NOW)), ['act']);
  assert.deepEqual(ids(await store.searchStored(db.alice, 'alice', 7, 25, 'ACT prep OR SAT', NOW)), ['act', 'sat']);
  assert.deepEqual(ids(await store.searchStored(db.alice, 'alice', 2, 25, 'ACT prep newer_than:60d', NOW)), ['act', 'old'], '"prep" finds "preparation"');
  assert.deepEqual(ids(await store.searchStored(db.alice, 'alice', 7, 25, 'from:prep.example', NOW)), ['act']);
  assert.deepEqual(ids(await store.searchStored(db.alice, 'alice', 7, 2, '', NOW)), ['act', 'contact'], 'no words: the newest in the window');
  assert.deepEqual(ids(await store.searchStored(db.alice, 'alice', 7, 25, 'percent', NOW)), []);
});

test('one person never reads or changes another person\'s copy', async (t) => {
  const db = await database(t);
  await store.syncGmail(db.alice, 'alice', gmail(MAIL).reader, Date.now() + 10_000, NOW);
  assert.deepEqual((await store.searchStored(db.bob, 'alice', 30, 25, 'ACT', NOW)).messages, [], 'row security hides alice\'s rows from bob');
  assert.equal(await store.readStoreState(db.bob, 'alice'), null);
  await assert.rejects(db.bob.query(`INSERT INTO oshal_email_messages (msg_key, user_sub, provider, message_id, received_at) VALUES ('x', 'alice', 'google', 'x', now())`), /row-level security/);
  assert.equal((await db.owner.query('SELECT count(*)::int AS n FROM oshal_email_messages')).rows[0].n, 4);
});

test('the store issues no statement shape that copies a whole table on the native kernel', () => {
  const source = fs.readFileSync(path.join(PKG, 'routes', 'mail-store.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const shape of [/ON\s+CONFLICT/i, /ORDER\s+BY/i, /DISTINCT/i, /\bOFFSET\b/i]) assert.doesNotMatch(source, shape);
});

/** Drive one compiled route under the kernel egress with a real pool and a scripted Gmail. */
async function route(name, pool, { query = {}, mail = MAIL } = {}) {
  const box = gmail(mail, { pageSize: 100 });
  const saved = globalThis.fetch;
  const seen = [];
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    seen.push(u);
    const body = u.pathname.endsWith('/messages')
      ? await box.reader.list(u.searchParams.get('q'), u.searchParams.get('pageToken') || undefined).then((p) => ({ messages: p.ids.map((id) => ({ id })), nextPageToken: p.next }))
      : await box.reader.metadata(decodeURIComponent(u.pathname.split('/').pop()));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ctx = { pool, intent: async () => ({ connections: [{ provider: 'google', revoked: false, expires_at_ms: null, renewable: true }] }) };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } };
  try {
    await createEmailRoutes(ctx).routes[name]({ oidc: { user: { sub: 'alice' } }, query, params: {}, body: {} }, res);
  } finally {
    globalThis.fetch = saved;
    delete process.env.OSHAL_EGRESS;
  }
  return { res, seen };
}

test('the routes: GET /messages reads Gmail until a pass has run, POST /sync stores, then GET /messages answers from the copy', async (t) => {
  const db = await database(t);
  const before = await route('GET /messages', db.alice, { query: { q: 'ACT prep', days: '2' } });
  assert.equal(before.res.body.source, 'live');
  assert.equal(before.res.body.store, null);
  assert.equal(before.seen[0].searchParams.get('q'), 'ACT prep newer_than:2d');
  const sync = await route('POST /sync', db.alice);
  assert.equal(sync.res.statusCode, 200);
  assert.equal(sync.res.body.inserted, 4);
  assert.equal(sync.res.body.state.complete, true);
  const after = await route('GET /messages', db.alice, { query: { q: 'ACT prep', days: '60' } });
  assert.equal(after.res.body.source, 'stored');
  assert.deepEqual(after.res.body.messages.map((m) => m.id), ['act', 'old'], 'a stored search reaches past the live 30-day limit');
  assert.equal(after.res.body.days, 60);
  assert.equal(after.res.body.store.stored, 4);
  assert.deepEqual(after.seen, [], 'no Gmail request answered the search');
  const status = await route('GET /sync/status', db.alice);
  assert.equal(status.res.body.fresh, true);
  assert.deepEqual(status.res.body.schedule, { app: 'email-summarizer', name: 'mail-copy' });
  const short = await route('GET /messages', db.alice, { query: { q: 'ACT', days: '60' } });
  assert.equal(short.res.body.source, 'stored');
  await db.alice.query(`UPDATE oshal_email_sync SET backfill_done = false, oldest_at = now() - interval '10 days'`);
  assert.equal((await route('GET /messages', db.alice, { query: { q: 'ACT', days: '60' } })).res.body.source, 'live', 'a copy reaching 10 days back does not answer a 60-day search');
  assert.equal((await route('GET /messages', db.alice, { query: { q: 'ACT', days: '2' } })).res.body.source, 'stored', 'it answers a 2-day one');
  await db.alice.query('UPDATE oshal_email_sync SET last_run_at = now() - interval \'2 hours\'');
  assert.equal((await route('GET /messages', db.alice, { query: { q: 'ACT' } })).res.body.source, 'live', 'a stale copy is not offered');
});
