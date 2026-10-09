/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard the two 1.26.0 owner-scoped removals through the COMPILED routes, the real engine dispatch (lease admission, then the caller's Firecrawl brokerage query), the real runner, bin/oshal-jobhunter.js and the engine. DELETE /stories/test-lab/:tag removes exactly the caller's stories carrying that run's mark: an unmarked story and another run's marked story survive, another user and an anonymous caller reach nothing, and the profile ends byte-for-byte as seeded. DELETE /jobs/:id/packet discards only the caller's own packet and returns the caller's own row to unworked, on the per-user SQLite store (the box's store) and on a disposable FORCE-RLS PostgreSQL database (engine in JOBHUNTER_STORE=postgres, bound to the caller by OSHAL_USER_SUB): another user's packet on the same posting survives with its row, a posting the caller has no packet for answers 404, and an applied posting answers 409 with nothing touched. Scoped doubles: the Express router and JSON body parser (node:http), the OIDC session (a cookie-to-subject map), the logger, the kernel trusted-service decoder (never trusted), the kernel request identity (tests/helpers/request-identity-stub.mjs), the unused SQLite driver and apply-run ledger (tripwires), the Postgres pool that answers the Firecrawl brokerage query with no row, and the token decryptor (a tripwire the empty brokerage never reaches).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adminUrl, postgresSkip, requireProvisionedInCi } from './helpers/career-pg-env.mjs';
import { createRouter, isolateRunnerEnv, loadCompiledModules, python, sqliteRows, startServer } from './helpers/career-route-harness.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'career-test-lab-cleanup-'));
const OWNER = 'cleanup-owner';
const OTHER = 'cleanup-other';
const SESSIONS = new Map([['session-owner', OWNER], ['session-other', OTHER]]);
const TAG = 'accept-0001aa';
const OTHER_TAG = 'accept-0002bb';
const mark = (tag) => `[oshal-test-lab:${tag}]`;

/** The candidate's own story, recorded before any acceptance run: it must survive every removal. */
const OWN_STORY = {
  at: '2026-09-01T12:00:00+00:00', title: 'Release pipeline', story: 'I rebuilt the release pipeline.',
  bullet: 'Cut deploy time from 40 minutes to 6', answer: 'I rebuilt the release pipeline.', source: 'verbatim',
};
const SEED_PROFILE = {
  profile: { name: 'Sample Candidate' },
  roles: [
    { title: 'Platform Lead', org: 'Acme', deliverables: ['Cut deploy time from 40 minutes to 6'], stories: [OWN_STORY] },
    { title: 'Site Reliability Engineer', org: 'Beta Corp', deliverables: ['Ran the on-call rotation for 30 services'] },
  ],
};

const brokerQueries = [];
let server;
let baseUrl;
let routes;
let counters;
let restoreEnv;

/** The Postgres pool double: it records the brokerage query and has no Firecrawl row for anyone. */
const brokerPool = {
  async query(config, params) {
    const values = typeof config === 'string' ? params : config.values;
    brokerQueries.push({ values: [...(values || [])] });
    return { rows: [] };
  },
};

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
    method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(90_000),
  });
  return { status: response.status, body: await response.json() };
}

const profilePath = (sub) => path.join(routes.userStore.userPaths(sub).userDir, 'career_db.json');
const readProfile = (sub) => JSON.parse(readFileSync(profilePath(sub), 'utf8'));
const runsOf = (sub) => routes.engineRuns.listEngineRuns(sub);

/** The engine runs a block of work started, per subject. */
async function observe(work) {
  const before = { [OWNER]: runsOf(OWNER).length, [OTHER]: runsOf(OTHER).length };
  const result = await work();
  return { result, runs: (sub) => runsOf(sub).slice(0, runsOf(sub).length - before[sub]) };
}

before(async () => {
  restoreEnv = isolateRunnerEnv(path.join(fixtureRoot, 'store'));
  ({ modules: routes, counters } = loadCompiledModules({
    stories: 'routes/career-stories-routes.js',
    board: 'routes/career-board-routes.js',
    userStore: 'routes/career-user-store.js',
    engineRuns: 'lib/career-engine-runs.js',
  }));
  const router = createRouter();
  routes.stories.registerCareerStoryRoutes(router, { pool: brokerPool });
  routes.board.registerCareerBoardRoutes(router, { pool: brokerPool });
  ({ server, baseUrl } = await startServer(router, sessionSubject));
  process.env.PORT = String(server.address().port);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreEnv();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Record the acceptance run's marked answers through the real review route. */
async function answerMarked() {
  const answers = [
    [0, `${mark(TAG)} I cut deploy time from 40 minutes to 6 by caching layers.`],
    [1, `${mark(TAG)} I ran the on-call rotation for 30 services and halved the pages.`],
    [1, `${mark(OTHER_TAG)} A second run also ran the on-call rotation.`],
  ];
  for (const [role, response] of answers) {
    const saved = await call('POST', '/stories/answer', 'session-owner', { role, response });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.body.story.answer, response, 'the answer, mark included, is kept verbatim');
  }
}

test('the removal route takes out exactly the caller\'s stories carrying the run\'s mark', { timeout: 300_000 }, async () => {
  const ownerDir = routes.userStore.userPaths(OWNER).userDir;
  mkdirSync(ownerDir, { recursive: true });
  writeFileSync(profilePath(OWNER), JSON.stringify(SEED_PROFILE, null, 2));
  await answerMarked();
  assert.deepEqual(readProfile(OWNER).roles.map((role) => role.stories.length), [2, 2]);

  const snapshot = readFileSync(profilePath(OWNER), 'utf8');
  const denied = await observe(() => call('DELETE', `/stories/test-lab/${TAG}`, 'session-other'));
  assert.deepEqual([denied.result.status, denied.result.body.error], [404, 'no story carries this Test Lab mark']);
  assert.equal(denied.runs(OTHER).length, 1, 'the other user\'s request ran in the other user\'s store');
  assert.deepEqual(denied.runs(OWNER), [], 'nothing ran as the owner');
  assert.equal(readFileSync(profilePath(OWNER), 'utf8'), snapshot, 'another user reaches nothing of the owner\'s');

  const refused = await observe(async () => [
    await call('DELETE', `/stories/test-lab/${TAG}`),
    await call('DELETE', '/stories/test-lab/Not-A-Tag', 'session-owner'),
    await call('DELETE', '/stories/test-lab/short', 'session-owner'),
  ]);
  assert.deepEqual(refused.result.map((reply) => reply.status), [401, 400, 400]);
  assert.deepEqual([refused.runs(OWNER), refused.runs(OTHER)], [[], []], 'refusals start no engine run');
  assert.equal(readFileSync(profilePath(OWNER), 'utf8'), snapshot);

  const removed = await call('DELETE', `/stories/test-lab/${TAG}`, 'session-owner');
  assert.deepEqual([removed.status, removed.body.removed, removed.body.roles], [200, 2, [0, 1]]);
  const after = readProfile(OWNER);
  assert.deepEqual(after.roles[0].stories, [OWN_STORY], 'the candidate\'s own story survives, unchanged');
  assert.equal(after.roles[1].stories.length, 1, 'another run\'s marked story survives');
  assert.ok(after.roles[1].stories[0].answer.startsWith(mark(OTHER_TAG)));
  assert.equal((await call('DELETE', `/stories/test-lab/${TAG}`, 'session-owner')).status, 404, 'a second removal finds nothing');

  const other = await call('DELETE', `/stories/test-lab/${OTHER_TAG}`, 'session-owner');
  assert.deepEqual([other.status, other.body.removed], [200, 1]);
  assert.deepEqual(readProfile(OWNER), SEED_PROFILE, 'with both runs removed the profile is exactly as seeded');
  assert.equal(counters.decryptCalls, 0, 'no Firecrawl row, nothing decrypted');
  assert.ok(brokerQueries.every((query) => [OWNER, OTHER].includes(query.values[0])), 'brokerage only ever asked for a caller');
});

// ─── packets ────────────────────────────────────────────────────────────────

const COMPANY = 7;
const P_SHARED = 41;   // both users hold a generated packet
const P_OWNER = 42;    // only the owner holds one
const P_APPLIED = 43;  // the owner applied with this packet

const packetDir = (sub, posting) => path.join(routes.userStore.userPaths(sub).userDir, 'applications', `Fixture-Systems__${posting}`);

/** Write one packet the way generate_for leaves it (application.json plus a rendered file). */
function writePacket(sub, posting) {
  const dir = packetDir(sub, posting);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'application.json'), JSON.stringify({ posting_id: posting, company: 'Fixture Systems', stories_cited: [] }));
  writeFileSync(path.join(dir, 'Resume_ATS.pdf'), 'fixture');
  return dir;
}

/** The per-user rows each owner starts with: [posting, status]. */
const SEED_ROWS = { [OWNER]: [[P_SHARED, 'generated'], [P_OWNER, 'generated'], [P_APPLIED, 'applied']], [OTHER]: [[P_SHARED, 'generated']] };

/** One subject's SQLite store, read (and optionally seeded) through the engine's own connect(). */
const storeRows = (sub, statements) => sqliteRows(routes.userStore.userPaths(sub), sub, statements);

/** The SQLite store: the box's store today. An untouched posting holds the column default 'new'. */
const sqliteBackend = {
  name: 'sqlite',
  unworked: 'new',
  async seed() {
    const corpus = [
      ['INSERT INTO corpus.companies (id, name) VALUES (?, ?)', [COMPANY, 'Fixture Systems']],
      ...[P_SHARED, P_OWNER, P_APPLIED].map((id) => ['INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, title) VALUES (?, ?, ?, ?)', [id, COMPANY, String(id), `Role ${id}`]]),
    ];
    for (const [sub, rows] of Object.entries(SEED_ROWS)) {
      const own = rows.map(([posting, status]) => ['INSERT INTO user_signals (posting_id, status, resume_path, cover_path, generated_at) VALUES (?, ?, ?, ?, ?)',
        [posting, status, path.join(writePacket(sub, posting), 'Resume_ATS.pdf'), 'cover.pdf', '2026-09-20T00:00:00+00:00']]);
      storeRows(sub, sub === OWNER ? [...corpus, ...own] : own);
    }
  },
  async rows(sub) { return storeRows(sub).map(({ posting_id, status, resume_path, generated_at }) => ({ posting_id, status, resume_path, generated_at })); },
  async close() {},
};

/** Start the disposable PostgreSQL holder and return a request function plus the app role's URL. */
async function holdPostgres() {
  const child = spawn(python, [path.join(packageRoot, 'tests', 'helpers', 'career_pg_hold.py'), '--admin-url', adminUrl], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', DATABASE_URL: '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async (prefix) => {
    const { value, done } = await lines.next();
    assert.ok(!done && value.startsWith(prefix), `postgres holder: ${value || ''} ${stderr}`);
    return JSON.parse(value.slice(prefix.length));
  };
  const { url } = await next('CAREER_PG_HOLD=');
  const sql = async (as, text, params = []) => {
    child.stdin.write(`${JSON.stringify({ as, sql: text, params })}\n`);
    const reply = await next('CAREER_PG_REPLY=');
    assert.equal(reply.error, undefined, reply.error);
    return reply.rows;
  };
  const close = () => new Promise((resolve) => { child.once('exit', resolve); child.stdin.end(); });
  return { url, sql, close };
}

/** A disposable FORCE-RLS database; the engine runs as its NOBYPASSRLS role. An untouched posting holds 'new'. */
function postgresBackend() {
  let held;
  return {
    name: 'postgres',
    unworked: 'new',
    async seed() {
      held = await holdPostgres();
      await held.sql(null, 'INSERT INTO career_companies (id, name) VALUES (%s, %s)', [COMPANY, 'Fixture Systems']);
      for (const id of [P_SHARED, P_OWNER, P_APPLIED]) {
        await held.sql(null, 'INSERT INTO career_postings (id, company_id, ats_job_id, title) VALUES (%s, %s, %s, %s)', [id, COMPANY, String(id), `Role ${id}`]);
      }
      for (const [sub, rows] of Object.entries(SEED_ROWS)) {
        for (const [posting, status] of rows) {
          await held.sql(sub, 'INSERT INTO career_user_applications (user_sub, posting_id, status, resume_path, cover_path, generated_at) VALUES (%s, %s, %s, %s, %s, NOW())',
            [sub, posting, status, path.join(writePacket(sub, posting), 'Resume_ATS.pdf'), 'cover.pdf']);
        }
      }
      process.env.JOBHUNTER_STORE = 'postgres';
      process.env.DATABASE_URL = held.url;
    },
    async rows(sub) {
      const rows = await held.sql(null, 'SELECT posting_id, status, resume_path, generated_at FROM career_user_applications WHERE user_sub = %s ORDER BY posting_id', [sub]);
      return rows.map((row) => ({ ...row, posting_id: Number(row.posting_id), generated_at: row.generated_at === null ? null : String(row.generated_at) }));
    },
    async close() {
      delete process.env.JOBHUNTER_STORE;
      delete process.env.DATABASE_URL;
      if (held) await held.close();
    },
  };
}

/** Assert one row is back to unworked: the packet's status and every pointer to it cleared. */
function assertUnworked(backend, row) {
  assert.deepEqual({ status: row.status, resume_path: row.resume_path, generated_at: row.generated_at },
    { status: backend.unworked, resume_path: null, generated_at: null }, `posting ${row.posting_id} is unworked again`);
}

/** Another user, and a posting the caller has no packet for: nothing of the owner's moves. */
async function deniedAcrossUsers(backend) {
  const ownerRows = await backend.rows(OWNER);
  const denied = await call('DELETE', `/jobs/${P_OWNER}/packet`, 'session-other');
  assert.deepEqual([denied.status, denied.body.error], [404, 'no generated packet for this posting']);
  assert.ok(existsSync(packetDir(OWNER, P_OWNER)), 'the owner\'s packet is still on disk');
  assert.deepEqual(await backend.rows(OWNER), ownerRows, 'the owner\'s rows are untouched');

  const own = await call('DELETE', `/jobs/${P_SHARED}/packet`, 'session-other');
  assert.deepEqual([own.status, own.body.ok, own.body.status], [200, true, backend.unworked]);
  assert.ok(!existsSync(packetDir(OTHER, P_SHARED)), 'the other user\'s own packet is gone');
  assertUnworked(backend, (await backend.rows(OTHER)).find((row) => row.posting_id === P_SHARED));
  assert.ok(existsSync(packetDir(OWNER, P_SHARED)), 'the owner\'s packet on the same posting survives');
  assert.deepEqual(await backend.rows(OWNER), ownerRows, 'and so does the owner\'s row for it');
  return ownerRows;
}

/** The owner's own removals: refusals first (nothing moves), then the generated packet goes. */
async function ownerRemovals(backend, ownerRows) {
  const refused = await observe(async () => [
    await call('DELETE', `/jobs/${P_SHARED}/packet`),
    await call('DELETE', '/jobs/abc/packet', 'session-owner'),
  ]);
  assert.deepEqual(refused.result.map((reply) => reply.status), [401, 400]);
  assert.deepEqual(refused.runs(OWNER), [], 'refusals start no engine run');
  const applied = await call('DELETE', `/jobs/${P_APPLIED}/packet`, 'session-owner');
  assert.deepEqual([applied.status, applied.body.error], [409, 'the posting is applied: its packet is the application record']);
  assert.ok(existsSync(packetDir(OWNER, P_APPLIED)));
  assert.deepEqual(await backend.rows(OWNER), ownerRows, 'an applied posting keeps its packet and its row');

  const removed = await call('DELETE', `/jobs/${P_SHARED}/packet`, 'session-owner');
  assert.deepEqual([removed.status, removed.body.removed], [200, [`Fixture-Systems__${P_SHARED}`]]);
  assert.ok(!existsSync(packetDir(OWNER, P_SHARED)));
  const rows = await backend.rows(OWNER);
  assertUnworked(backend, rows.find((row) => row.posting_id === P_SHARED));
  assert.deepEqual(rows.filter((row) => row.posting_id !== P_SHARED), ownerRows.filter((row) => row.posting_id !== P_SHARED), 'the other packets\' rows are untouched');
  assert.ok(existsSync(packetDir(OWNER, P_OWNER)));
  assert.equal((await call('DELETE', `/jobs/${P_SHARED}/packet`, 'session-owner')).status, 404, 'a second removal finds nothing');
}

/** One backend, from a clean store to every removal case. */
async function packetScenario(backend) {
  rmSync(path.join(fixtureRoot, 'store'), { recursive: true, force: true });
  try {
    await backend.seed();
    const ownerRows = await deniedAcrossUsers(backend);
    await ownerRemovals(backend, ownerRows);
  } finally {
    await backend.close();
  }
}

test('packet removal on the per-user SQLite store reaches only the caller\'s packet and row', { timeout: 300_000 }, async () => {
  await packetScenario(sqliteBackend);
});

test('packet removal on disposable FORCE-RLS PostgreSQL reaches only the caller\'s packet and row', { timeout: 300_000, skip: postgresSkip(false) }, async () => {
  requireProvisionedInCi();
  await packetScenario(postgresBackend());
});
