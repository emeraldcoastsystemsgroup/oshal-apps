/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove tests/stories-live-acceptance.mjs before any box runs it (1.26.0): the script is driven UNCHANGED, through its own bearer client, against a loopback api. The story review, readiness, the master and packet documents and both removals are the COMPILED routes over the real engine dispatch, runner, launcher and engine on a fixture store; the pass leaves the profile exactly as seeded and the borrowed posting's row as it was. An incomplete cleanup, a packet that cites no story, auto-submit on, and an identity with no indexed resume each give the verdict they must, and the last two write nothing. Scoped doubles: the PAT (a bearer-to-subject map), the Postgres pool (no Firecrawl row), the kernel leaves in tests/helpers/career-route-harness.mjs, and the board side the Career bot rail and better-sqlite3 stand behind: GET /automation/state, GET /jobs, GET /jobs/:id (reading the real store through the engine), GET /runs and POST /jobs/:id/generate, which writes the packet and the row generate_for leaves (application.json with the stories_cited it verifies) instead of calling a model.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { bearerApi, CASE_ID, markFor, runStoriesAcceptance } from './stories-live-acceptance.mjs';
import { createRouter, isolateRunnerEnv, loadCompiledModules, sqliteRows, startServer } from './helpers/career-route-harness.mjs';

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'career-stories-live-'));
const OPERATOR = 'live-operator';
const NEWCOMER = 'live-newcomer';
const TOKENS = new Map([['operator-pat-fixture', OPERATOR], ['newcomer-pat-fixture', NEWCOMER]]);
const COMPANY = 7;
const P_OPEN = 51;     // scored, never worked: the posting the packet step may borrow
const P_APPLIED = 52;  // applied with a packet: never borrowed, never touched
const OWN_STORY = {
  at: '2026-09-01T12:00:00+00:00', title: 'Release pipeline', story: 'I rebuilt the release pipeline.',
  bullet: 'Cut deploy time from 40 minutes to 6', answer: 'I rebuilt the release pipeline.', source: 'verbatim',
};
const SEED_PROFILE = {
  profile: { name: 'Sample Candidate' },
  roles: [
    { title: 'Platform Lead', org: 'Acme', deliverables: ['Cut deploy time from 40 minutes to 6'], stories: [OWN_STORY] },
    { title: 'Site Reliability Engineer', org: 'Beta Corp', deliverables: ['Ran the on-call rotation for 30 services', 'Moved alerting onto Prometheus'] },
    { title: 'Systems Administrator', org: 'Gamma Labs', deliverables: ['Automated server provisioning with configuration scripts'] },
  ],
};

let server;
let baseUrl;
let routes;
let restoreEnv;
/** What the board-side doubles answer with, set per test. */
const board = { autoSubmit: false, citeNothing: false, runs: [] };
const pool = { async query() { return { rows: [] }; } };

const paths = (sub) => routes.userStore.userPaths(sub);
const storeRows = (sub, statements) => sqliteRows(paths(sub), sub, statements);
const profilePath = (sub) => path.join(paths(sub).userDir, 'career_db.json');
const packetDir = (sub, posting) => path.join(paths(sub).userDir, 'applications', `Fixture-Systems__${posting}`);
const bearerSubject = (headers) => TOKENS.get(String(headers.authorization || '').replace(/^Bearer /, ''));
const subOf = (req) => req.oidc?.user?.sub;

/** The per-posting card fields the board routes derive from the caller's row. */
function jobCard(sub, posting) {
  const row = storeRows(sub).find((r) => r.posting_id === posting) || {};
  return { id: posting, status: row.status ?? null, generated_at: row.generated_at ?? null, has_resume: row.resume_path ? 1 : 0, has_cover: row.cover_path ? 1 : 0 };
}

/** Leave what generate_for leaves: the packet folder, its verified citations, and the caller's row. */
function writeGeneratedPacket(sub, posting) {
  const profile = JSON.parse(readFileSync(profilePath(sub), 'utf8'));
  const cited = board.citeNothing ? [] : profile.roles.flatMap((role) => (role.stories || [])
    .filter((s) => s.story && !s.weak).slice(0, 1)
    .map((s) => ({ role: role.title, org: role.org, title: s.title || '', bullet: s.bullet || '', story: s.story })));
  const dir = packetDir(sub, posting);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'application.json'), JSON.stringify({ posting_id: posting, company: 'Fixture Systems', stories_cited: cited, generated: { resume: {}, cover: {} } }));
  writeFileSync(path.join(dir, 'Resume_ATS.pdf'), 'fixture');
  storeRows(sub, [['UPDATE user_signals SET status=?, generated_at=?, resume_path=?, cover_path=? WHERE posting_id=?',
    ['generated', '2026-09-28T00:00:00+00:00', path.join(dir, 'Resume_ATS.pdf'), path.join(dir, 'CoverLetter.pdf'), posting]]]);
}

/** Register the board-side doubles first, so they answer before the compiled board routes. */
function registerBoardDoubles(router) {
  router.get('/automation/state', (req, res) => res.json({ autoGenerate: false, autoSubmit: board.autoSubmit }));
  router.get('/jobs', (req, res) => res.json({ jobs: [P_APPLIED, P_OPEN].map((posting) => jobCard(subOf(req), posting)) }));
  router.get('/jobs/:id', (req, res) => res.json({ job: jobCard(subOf(req), Number(req.params.id)) }));
  router.get('/runs', (req, res) => res.json({ runs: board.runs.filter((run) => run.owner === subOf(req)).map(({ owner, ...run }) => run) }));
  router.post('/jobs/:id/generate', (req, res) => {
    const run = { owner: subOf(req), runId: `run-${board.runs.length + 1}`, verb: 'tailor', state: 'running', reason: null, startedAt: Date.now(), railCalls: 0 };
    board.runs.unshift(run);
    setTimeout(() => { writeGeneratedPacket(run.owner, Number(req.params.id)); Object.assign(run, { state: 'succeeded', railCalls: 2 }); }, 20);
    res.status(202).json({ ok: true, status: 'generating' });
  });
}

/** Seed the operator's store: the corpus, one open and one applied posting, and the profile. */
function seedOperator() {
  const applied = packetDir(OPERATOR, P_APPLIED);
  mkdirSync(applied, { recursive: true });
  writeFileSync(path.join(applied, 'application.json'), JSON.stringify({ posting_id: P_APPLIED, stories_cited: [] }));
  storeRows(OPERATOR, [
    ['INSERT INTO corpus.companies (id, name) VALUES (?, ?)', [COMPANY, 'Fixture Systems']],
    ...[P_OPEN, P_APPLIED].map((id) => ['INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, title) VALUES (?, ?, ?, ?)', [id, COMPANY, String(id), `Role ${id}`]]),
    ['INSERT INTO user_signals (posting_id, fit_score) VALUES (?, ?)', [P_OPEN, 81]],
    ['INSERT INTO user_signals (posting_id, status, resume_path, applied_at) VALUES (?, ?, ?, ?)', [P_APPLIED, 'applied', path.join(applied, 'Resume_ATS.pdf'), '2026-09-20T00:00:00+00:00']],
  ]);
  writeFileSync(profilePath(OPERATOR), JSON.stringify(SEED_PROFILE, null, 2));
  mkdirSync(paths(NEWCOMER).userDir, { recursive: true });
  writeFileSync(profilePath(NEWCOMER), JSON.stringify({ profile: {}, roles: [] }));
}

before(async () => {
  restoreEnv = isolateRunnerEnv(path.join(fixtureRoot, 'store'));
  ({ modules: routes } = loadCompiledModules({
    stories: 'routes/career-stories-routes.js',
    readiness: 'routes/career-readiness.js',
    studio: 'routes/career-resume-studio-routes.js',
    board: 'routes/career-board-routes.js',
    userStore: 'routes/career-user-store.js',
  }));
  const router = createRouter();
  registerBoardDoubles(router);
  routes.stories.registerCareerStoryRoutes(router, { pool });
  routes.readiness.registerCareerReadinessRoutes(router);
  routes.studio.registerCareerResumeStudio(router, { pool });
  routes.board.registerCareerBoardRoutes(router, { pool });
  ({ server, baseUrl } = await startServer(router, bearerSubject));
  process.env.PORT = String(server.address().port);
  seedOperator();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreEnv();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

const FAST = { pollMs: 5, sleep: () => new Promise((resolve) => setTimeout(resolve, 5)) };
const operatorApi = () => bearerApi(baseUrl, 'operator-pat-fixture');

/** Everything the walk may touch is back exactly as seeded. */
function assertLeftAsFound() {
  assert.deepEqual(JSON.parse(readFileSync(profilePath(OPERATOR), 'utf8')), SEED_PROFILE, 'the profile is exactly as seeded');
  assert.ok(!existsSync(packetDir(OPERATOR, P_OPEN)), 'no packet is left on the borrowed posting');
  assert.deepEqual(jobCard(OPERATOR, P_OPEN), { id: P_OPEN, status: 'new', generated_at: null, has_resume: 0, has_cover: 0 });
  assert.equal(jobCard(OPERATOR, P_APPLIED).status, 'applied', 'the applied posting is never touched');
  assert.ok(existsSync(packetDir(OPERATOR, P_APPLIED)));
}

test('the walk passes against the real routes and leaves the store as it found it', { timeout: 300_000 }, async () => {
  const verdict = await runStoriesAcceptance({ api: operatorApi(), tag: 'accept-pass0001', ...FAST });
  assert.equal(verdict.caseId, CASE_ID);
  assert.equal(verdict.state, 'pass', `${verdict.detail} ${JSON.stringify(verdict.evidence)}`);
  const { evidence } = verdict;
  assert.deepEqual([evidence.roles, evidence.withStoryBefore, evidence.answered], [3, 1, 2], 'the card asked about the two roles with no story');
  assert.equal(evidence.readiness, '3 of 3 roles have a story.');
  assert.deepEqual(evidence.markedStories.map((s) => s.role), [1, 2]);
  assert.equal(evidence.postingId, P_OPEN, 'the applied posting is never borrowed');
  assert.equal(evidence.packetRun.state, 'succeeded');
  assert.ok(evidence.storiesCited >= 1);
  assert.equal(evidence.cleanup, 'deleted');
  assertLeftAsFound();
});

test('an incomplete cleanup is a failure, never a pass', { timeout: 300_000 }, async () => {
  const api = operatorApi();
  const skipsStoryRemoval = (method, route, body) => (method === 'DELETE' && route.includes('/stories/test-lab/')
    ? Promise.resolve({ status: 500, json: {} }) : api(method, route, body));
  const verdict = await runStoriesAcceptance({ api: skipsStoryRemoval, tag: 'accept-leak0001', ...FAST });
  assert.equal(verdict.state, 'fail');
  assert.match(verdict.detail, /^cleanup INCOMPLETE: story delete 500 .*2 marked left/);
  const removed = await api('DELETE', '/api/career-hunter/stories/test-lab/accept-leak0001');
  assert.deepEqual([removed.status, removed.json.removed], [200, 2], 'the leaked stories were exactly the run\'s two');
  assertLeftAsFound();
});

test('a packet that cites no story fails the case, and the cleanup still runs', { timeout: 300_000 }, async () => {
  board.citeNothing = true;
  try {
    const verdict = await runStoriesAcceptance({ api: operatorApi(), tag: 'accept-cite0001', ...FAST });
    assert.equal(verdict.state, 'fail');
    assert.equal(verdict.detail, 'the generated packet\'s application.json carries no stories_cited');
    assert.equal(verdict.evidence.cleanup, 'deleted');
  } finally {
    board.citeNothing = false;
  }
  assertLeftAsFound();
});

test('auto-submit on, or no indexed resume, is unavailable and writes nothing', { timeout: 120_000 }, async () => {
  const runsBefore = board.runs.length;
  board.autoSubmit = true;
  try {
    const verdict = await runStoriesAcceptance({ api: operatorApi(), tag: 'accept-auto0001', ...FAST });
    assert.equal(verdict.state, 'unavailable');
    assert.match(verdict.detail, /auto-submit is on/);
    assert.equal(verdict.evidence.cleanup, undefined, 'nothing was written, so there is nothing to clean');
  } finally {
    board.autoSubmit = false;
  }
  const newcomer = await runStoriesAcceptance({ api: bearerApi(baseUrl, 'newcomer-pat-fixture'), tag: 'accept-none0001', ...FAST });
  assert.deepEqual([newcomer.state, newcomer.detail], ['unavailable', 'the automation identity has no indexed resume (GET /stories reports 0 roles); nothing was written']);
  assert.equal(board.runs.length, runsBefore, 'no packet was started');
  assert.ok(!readFileSync(profilePath(OPERATOR), 'utf8').includes(markFor('accept-auto0001')));
  assertLeftAsFound();
});
