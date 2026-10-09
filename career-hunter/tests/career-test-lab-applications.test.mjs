/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the 1.27.0 Test Lab application seam through the COMPILED routes, the caller's real SQLite store (seeded through the engine's own connect(), read by the route through the real better-sqlite3 driver) and a disposable PostgreSQL database holding the package's own career_hunter_applications migrations, queried as a LOGIN NOSUPERUSER NOBYPASSRLS role. POST /test-lab/applications plants exactly one marked application (ticket + row, awaiting approval, the deterministic ticket key the queue uses) on an untouched posting and refuses, writing nothing, an anonymous caller, a malformed mark, a missing or inactive posting, a worked posting, a posting with an application or an application ticket, and a caller with no store. DELETE /test-lab/applications/:postingId/:tag removes only the caller's application whose ticket carries that tag: an unmarked queue application, another tag, another user's same-posting application and another user asking all survive; a drafting or applied application answers 409; a failed ticket delete is finished by the retry. The approve round trip runs the real approve handler, runner, launcher and engine on a planted application: the draft reaches the engine's model rail and is refused there (career worker unavailable: rail-not-configured, because the fixture's caller carries no verified issuer, so the runner mints no grant), the handler records error/escalated, and the removal afterwards leaves both stores as they were. Scoped doubles: the Express router and JSON body parser (node:http), the OIDC session (a cookie-to-subject map), the logger, the kernel trusted-service decoder (never trusted), the kernel request identity (tests/helpers/request-identity-stub.mjs), the apply-run ledger and token decryptor (tripwires), and the kernel TicketService (an in-memory double keeping the kernel's create-reuses-the-external-key contract; the real service's deleteTicket and getTicketByExternalId are what the live acceptance crosses).
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { adminUrl, loaderNodePath, packageRoot, postgresSkip, requireProvisionedInCi } from './helpers/career-pg-env.mjs';
import { createRouter, isolateRunnerEnv, loadCompiledModules, sqliteRows, startServer } from './helpers/career-route-harness.mjs';

const OWNER = 'seam-owner';
const OTHER = 'seam-other';
const NO_STORE = 'seam-no-store';
const SESSIONS = new Map([['session-owner', OWNER], ['session-other', OTHER], ['session-no-store', NO_STORE]]);
const TAG = 'rail-draft-0001aa';
const OTHER_TAG = 'rail-draft-0002bb';
const COMPANY = 9;
/** Postings: untouched ones the seam may borrow, and the ones it must refuse. */
const P = Object.freeze({ plant: 51, shared: 52, queued: 53, worked: 54, inactive: 55, held: 56, retry: 57, approve: 58, ticketOnly: 59, other: 60 });
/** The package migrations career_hunter_applications and its provenance columns come from (tests/helpers/career_pg.py BASE_MIGRATIONS). */
const MIGRATIONS = ['031-career-hunter.sql', '095-career-corpus.sql', '096-career-corpus-complete.sql', '097-career-postings-view.sql',
  '098-career-peruser-views.sql', '100-career-application-provenance.sql', '101-career-apply-claim-lease.sql',
  '102-career-apply-run-binding.sql', '103-career-interview-source-identity.sql'];
/** The advisory lock every Career contract takes on a shared server (tests/helpers/career_pg.py SERVER_LOCK_SQL). */
const SERVER_LOCK_SQL = "SELECT pg_advisory_lock(hashtext('oshal.career-hunter.contract-server'))";

const skip = postgresSkip(true);
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'career-test-lab-applications-'));
let routes;
let server;
let baseUrl;
let restoreEnv;
let pg;
let admin;
let pool;
let database;
let tickets;

/**
 * @description The kernel TicketService surface the seam and the approve handler use, in memory.
 * `createTicket` reuses an existing ticket under the same (provider, external id), as the kernel's
 * store does (ON CONFLICT ... DO NOTHING, then the existing row).
 * @returns {object} The double, with its `rows` map exposed for assertions.
 */
function ticketDouble() {
  const rows = new Map();
  const byKey = (provider, externalId) => [...rows.values()].find((t) => t.externalProvider === provider && t.externalId === externalId) || null;
  return {
    rows,
    failNextDelete: false,
    async createTicket(input) {
      const existing = input.externalId ? byKey(input.externalProvider, input.externalId) : null;
      if (existing) return existing;
      const ticket = { ...input, ticketId: randomUUID(), metadata: { ...(input.metadata || {}) } };
      rows.set(ticket.ticketId, ticket);
      return ticket;
    },
    async getTicket(ticketId) { return rows.get(ticketId) || null; },
    async getTicketByExternalId(provider, externalId) { return byKey(provider, externalId); },
    async updateStatus(ticketId, status, metadata) {
      const ticket = rows.get(ticketId);
      if (!ticket) throw new Error('ticket not found');
      ticket.status = status;
      if (metadata) ticket.metadata = { ...ticket.metadata, ...metadata };
    },
    async deleteTicket(ticketId) {
      if (this.failNextDelete) { this.failNextDelete = false; throw new Error('ticket store unavailable'); }
      rows.delete(ticketId);
    },
  };
}

/** The OIDC session a signed-in browser carries; no cookie, no subject. */
function sessionSubject(headers) {
  const match = /(?:^|;\s*)appSession=([^;]+)/.exec(headers.cookie || '');
  return match ? SESSIONS.get(match[1]) : undefined;
}

/** Call a package route as a browser session, or as nobody. */
async function call(method, route, session, body) {
  const headers = session ? { cookie: `appSession=${session}` } : {};
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}/api/career-hunter${route}`, {
    method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  return { status: response.status, body: await response.json() };
}

const storeRows = (sub, statements) => sqliteRows(routes.userStore.userPaths(sub), sub, statements);

/** Every application row, as the database holds it. */
async function applicationRows() {
  const result = await pool.query(`SELECT user_sub, posting_id, status, ticket_id::text AS ticket_id
    FROM career_hunter_applications ORDER BY user_sub, posting_id`);
  return result.rows;
}

/** Seed the tenant corpus and both users' signal rows through the engine's own connect(). */
function seedStores() {
  const corpus = [
    ['INSERT INTO corpus.companies (id, name) VALUES (?, ?)', [COMPANY, 'Fixture Systems']],
    ...Object.values(P).map((id) => ['INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, title, url, active, target_role) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [id, COMPANY, String(id), `Role ${id}`, `https://jobs.example/${id}`, id === P.inactive ? 0 : 1]]),
  ];
  storeRows(OWNER, [...corpus,
    ['INSERT INTO user_signals (posting_id, status, ai_fit_score) VALUES (?, ?, ?)', [P.queued, 'new', 88]],
    ['INSERT INTO user_signals (posting_id, status, resume_path, generated_at) VALUES (?, ?, ?, ?)', [P.worked, 'generated', 'Resume_ATS.pdf', '2026-09-20T00:00:00+00:00']],
  ]);
  storeRows(OTHER, []);
}

/** Create the disposable role and database, and apply the package migrations as that role. */
async function provisionDatabase() {
  admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(SERVER_LOCK_SQL);
  const suffix = randomBytes(6).toString('hex');
  const role = `career_seam_${suffix}`;
  const password = randomBytes(12).toString('hex');
  database = { role, name: `career_seam_${suffix}` };
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query(`CREATE DATABASE ${database.name} OWNER ${role}`);
  const url = new URL(adminUrl);
  Object.assign(url, { username: role, password, pathname: `/${database.name}` });
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  for (const name of MIGRATIONS) {
    await pool.query(readFileSync(path.join(packageRoot, 'migrations', name), 'utf8'));
  }
  // The kernel's connection table, only as far as the engine dispatch's Firecrawl brokerage reads it; it holds no row.
  await pool.query('CREATE TABLE oshal_connections (user_sub TEXT, provider TEXT, access_token TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())');
}

before(async () => {
  requireProvisionedInCi();
  if (skip) return;
  const loaderRequire = createRequire(path.join(loaderNodePath, 'noop.js'));
  pg = loaderRequire('pg');
  restoreEnv = isolateRunnerEnv(path.join(fixtureRoot, 'store'));
  ({ modules: routes } = loadCompiledModules({
    seam: 'routes/career-test-lab-applications.js',
    applications: 'routes/career-application-routes.js',
    userStore: 'routes/career-user-store.js',
  }, { 'better-sqlite3': loaderRequire('better-sqlite3') }));
  await provisionDatabase();
  tickets = ticketDouble();
  const ctx = { pool, ticketService: tickets };
  const router = createRouter();
  routes.applications.registerCareerApplicationMutationRoutes(router, ctx);
  routes.seam.registerCareerTestLabApplicationRoutes(router, ctx);
  ({ server, baseUrl } = await startServer(router, sessionSubject));
  // Any rail URL the runner derives points at this fixture, never at a port something else may own.
  process.env.PORT = String(server.address().port);
  seedStores();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
  if (admin) {
    if (database) {
      await admin.query(`DROP DATABASE IF EXISTS ${database.name} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${database.role}`);
    }
    await admin.end();
  }
  if (restoreEnv) restoreEnv();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** The planted ticket for one owner and posting, looked up by the queue's own key. */
function ticketFor(sub, posting) {
  const key = routes.applications.applicationTicketKey(sub, posting);
  return [...tickets.rows.values()].find((t) => t.externalProvider === 'career-hunter' && t.externalId === key) || null;
}

test('plant writes one marked application on an untouched posting, through the queue\'s own ticket and row', { skip, timeout: 120_000 }, async () => {
  const signalsBefore = storeRows(OWNER);
  const planted = await call('POST', '/test-lab/applications', 'session-owner', { postingId: P.plant, tag: TAG });
  assert.deepEqual([planted.status, planted.body], [201, { ok: true, postingId: P.plant, tag: TAG, status: 'approval_required' }]);
  const ticket = ticketFor(OWNER, P.plant);
  assert.ok(ticket, 'the ticket carries the deterministic key the queue uses');
  assert.deepEqual([ticket.ownerSub, ticket.ticketType, ticket.status, ticket.metadata.test_lab_tag, ticket.metadata.posting_id],
    [OWNER, 'career-application', 'approval_required', TAG, P.plant]);
  assert.match(ticket.description, /not yet scored/, 'an unscored posting says so');
  const rows = (await applicationRows()).filter((row) => row.posting_id === P.plant);
  assert.deepEqual(rows, [{ user_sub: OWNER, posting_id: P.plant, status: 'approval_required', ticket_id: ticket.ticketId }]);
  assert.deepEqual(storeRows(OWNER), signalsBefore, 'the seam writes nothing to the caller\'s SQLite store');
});

test('plant refuses, writing nothing, every posting it may not borrow', { skip, timeout: 120_000 }, async () => {
  const queued = await routes.applications.enqueueForUser({ pool, ticketService: tickets }, OWNER, 1, { trigger: 'manual' });
  assert.equal(queued, 1, 'the real queue created the owner\'s unmarked application on the scored posting');
  await tickets.createTicket({ title: 'orphan', ticketType: 'career-application', ownerSub: OWNER, externalProvider: 'career-hunter',
    externalId: routes.applications.applicationTicketKey(OWNER, P.ticketOnly), metadata: {} });
  const before = { rows: await applicationRows(), tickets: tickets.rows.size, signals: storeRows(OWNER) };
  const attempts = [
    [undefined, { postingId: P.shared, tag: TAG }, 401],
    ['session-owner', { postingId: P.shared, tag: 'Bad Tag' }, 400],
    ['session-owner', { postingId: -3, tag: TAG }, 400],
    ['session-owner', { postingId: 999, tag: TAG }, 404],
    ['session-owner', { postingId: P.inactive, tag: TAG }, 404],
    ['session-owner', { postingId: P.worked, tag: TAG }, 409],
    ['session-owner', { postingId: P.queued, tag: TAG }, 409],
    ['session-owner', { postingId: P.plant, tag: OTHER_TAG }, 409],
    ['session-owner', { postingId: P.ticketOnly, tag: TAG }, 409],
    ['session-no-store', { postingId: P.shared, tag: TAG }, 409],
  ];
  for (const [session, body, status] of attempts) {
    const reply = await call('POST', '/test-lab/applications', session, body);
    assert.equal(reply.status, status, `${JSON.stringify(body)} as ${session}: ${JSON.stringify(reply.body)}`);
  }
  assert.deepEqual({ rows: await applicationRows(), tickets: tickets.rows.size, signals: storeRows(OWNER) }, before, 'no refusal wrote anything');
});

test('remove takes out only the caller\'s application whose ticket carries the tag', { skip, timeout: 120_000 }, async () => {
  for (const [session, posting] of [['session-owner', P.shared], ['session-other', P.shared], ['session-owner', P.other]]) {
    assert.equal((await call('POST', '/test-lab/applications', session, { postingId: posting, tag: TAG })).status, 201);
  }
  const before = await applicationRows();
  const refused = [
    [undefined, `/test-lab/applications/${P.shared}/${TAG}`, 401],
    ['session-owner', `/test-lab/applications/${P.shared}/Not-A-Tag`, 400],
    ['session-owner', `/test-lab/applications/${P.queued}/${TAG}`, 404],
    ['session-owner', `/test-lab/applications/${P.shared}/${OTHER_TAG}`, 404],
    ['session-other', `/test-lab/applications/${P.other}/${TAG}`, 404],
  ];
  for (const [session, route, status] of refused) {
    const reply = await call('DELETE', route, session);
    assert.equal(reply.status, status, `${route} as ${session}: ${JSON.stringify(reply.body)}`);
  }
  assert.deepEqual(await applicationRows(), before, 'no refusal removed a row');
  const ownerTicket = ticketFor(OWNER, P.shared).ticketId;
  const removed = await call('DELETE', `/test-lab/applications/${P.shared}/${TAG}`, 'session-owner');
  assert.deepEqual([removed.status, removed.body], [200, { ok: true, postingId: P.shared, removed: { application: true, ticket: true } }]);
  assert.equal(tickets.rows.has(ownerTicket), false, 'the owner\'s marked ticket is gone');
  const after = await applicationRows();
  assert.deepEqual(after, before.filter((row) => !(row.user_sub === OWNER && row.posting_id === P.shared)), 'exactly one row went');
  assert.ok(after.some((row) => row.user_sub === OTHER && row.posting_id === P.shared), 'another user\'s same-posting, same-tag application survives');
  assert.ok(ticketFor(OWNER, P.queued), 'the unmarked queue application keeps its ticket');
  assert.equal((await call('DELETE', `/test-lab/applications/${P.shared}/${TAG}`, 'session-owner')).status, 404, 'a second removal finds nothing');
});

test('a drafting or applied application is held; a failed ticket delete is finished by the retry', { skip, timeout: 120_000 }, async () => {
  for (const posting of [P.held, P.retry]) {
    assert.equal((await call('POST', '/test-lab/applications', 'session-owner', { postingId: posting, tag: TAG })).status, 201);
  }
  for (const status of ['drafting', 'applied']) {
    await pool.query('UPDATE career_hunter_applications SET status=$1 WHERE user_sub=$2 AND posting_id=$3', [status, OWNER, P.held]);
    const held = await call('DELETE', `/test-lab/applications/${P.held}/${TAG}`, 'session-owner');
    assert.deepEqual([held.status, held.body.status], [409, status]);
    assert.ok(ticketFor(OWNER, P.held), `a ${status} application keeps its ticket`);
  }
  await pool.query('UPDATE career_hunter_applications SET status=$1 WHERE user_sub=$2 AND posting_id=$3', ['drafted', OWNER, P.held]);
  assert.equal((await call('DELETE', `/test-lab/applications/${P.held}/${TAG}`, 'session-owner')).status, 200, 'a finished draft is removable');

  tickets.failNextDelete = true;
  const failed = await call('DELETE', `/test-lab/applications/${P.retry}/${TAG}`, 'session-owner');
  assert.equal(failed.status, 500);
  assert.equal((await applicationRows()).some((row) => row.user_sub === OWNER && row.posting_id === P.retry), false, 'the row went first');
  assert.ok(ticketFor(OWNER, P.retry), 'the ticket delete failed');
  const retried = await call('DELETE', `/test-lab/applications/${P.retry}/${TAG}`, 'session-owner');
  assert.deepEqual([retried.status, retried.body.removed], [200, { application: false, ticket: true }]);
  assert.equal(ticketFor(OWNER, P.retry), null, 'the retry found the ticket by its key and removed it');
});

test('approve runs the real draft on a planted application; removal afterwards leaves both stores as they were', { skip, timeout: 240_000 }, async () => {
  const signalsBefore = storeRows(OWNER);
  const rowsBefore = await applicationRows();
  assert.equal((await call('POST', '/test-lab/applications', 'session-owner', { postingId: P.approve, tag: TAG })).status, 201);
  const ticketId = ticketFor(OWNER, P.approve).ticketId;
  const approved = await call('POST', `/applications/${P.approve}/approve`, 'session-owner', {});
  assert.deepEqual([approved.status, approved.body.ok], [500, false], 'the draft failed');
  assert.match(approved.body.error, /career worker unavailable: rail-not-configured/, 'it failed at the engine\'s model rail, past the handler, the lease and the launcher');
  const row = (await applicationRows()).find((r) => r.user_sub === OWNER && r.posting_id === P.approve);
  assert.deepEqual([row.status, row.ticket_id], ['error', ticketId], 'the real approve handler drove the planted application');
  assert.equal(tickets.rows.get(ticketId).status, 'escalated');
  const removed = await call('DELETE', `/test-lab/applications/${P.approve}/${TAG}`, 'session-owner');
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(await applicationRows(), rowsBefore, 'the application store is as it was before the plant');
  assert.equal(tickets.rows.has(ticketId), false);
  assert.deepEqual(storeRows(OWNER), signalsBefore, 'the failed draft and the removal left the caller\'s signals untouched');
});
