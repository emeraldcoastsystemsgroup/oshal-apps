/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.69.0: the harness the swipe deck's suites share (tests/career-match-deck-routes.test.mjs, tests/career-match-deck-page.test.mjs). It mounts Career's real compiled board routes (routes/career-board-routes.js: GET /jobs, GET /jobs/stats, GET /jobs/:id, POST /jobs/:id/status) and its real compiled surface routes (routes/career-surface-routes.js: /board-native, /mobile, /static/:file) on a local Express server, over a real SQLite corpus and one real SQLite store per made-up person, written with the engine's own schema and opened by the routes with the real driver. Only what sits outside that boundary is stood in: the logger, the caller's identity (a cookie names the made-up person), the PostgreSQL pool, the engine launch, and the four reads the page makes of other route families (résumé state, application records, the frame's profile and the signed-in person).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCompiledModules } from './career-route-harness.mjs';

const require = createRequire(import.meta.url);
export const packageRoot = path.resolve(import.meta.dirname, '../..');
const toolchain = path.resolve(packageRoot, '..', 'scripts/toolchain');
const express = require(require.resolve('express', { paths: [toolchain] }));
/** The SQLite driver the routes open a person's store with, from the store toolchain. */
const Database = require(require.resolve('better-sqlite3', { paths: [toolchain] }));
const platform = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_CORE_ROOT;

const engineDb = readFileSync(path.join(packageRoot, 'engine/jobhunter/db.py'), 'utf8');
const schema = (name) => engineDb.match(new RegExp(name + '\\s*=\\s*"""([\\s\\S]*?)"""'))[1];

/** The made-up person the page signs in as, and a second one whose store must never move. */
export const PERSON = 'deck-person', OTHER = 'deck-other';

/**
 * @description Made-up jobs: ids from 101, each a different employer, newest first by id. The first has pay and a
 * long title; the second has no pay; the rest alternate.
 * @param {number} count How many.
 * @returns {Array<object>} Corpus rows.
 */
export function inventedJobs(count) {
  const titles = ['Staff Site Reliability Engineer, Developer Infrastructure and Tooling', 'Office Manager', 'Platform Engineer', 'Operations Lead', 'Program Coordinator', 'Data Analyst'];
  return Array.from({ length: count }, (_, i) => ({
    id: 101 + i, company: `Invented Employer ${String(i + 1).padStart(2, '0')}`, title: i < titles.length ? titles[i] : `Invented role ${i + 1}`,
    location: i % 2 ? 'Bend, OR' : 'Remote - US', remote: i % 2 ? 0 : 1, pay: i % 2 ? null : [120000 + i * 1000, 150000 + i * 1000],
    posted: `2026-11-${String(28 - (i % 27)).padStart(2, '0')}`, fit: 95 - (i % 40),
  }));
}

const RIBBON = [['home', 'Home', 'home'], ['search', 'Find jobs', 'search-ui'], ['board', 'My jobs', 'board-native'], ['resume-studio', 'My résumé', 'resume-studio']]
  .map(([id, label, view]) => ({ id: 'tool-career-' + id, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));

/** Who the request is from: the made-up person a cookie names, or nobody. */
function identify(req, _res, next) {
  const who = /(?:^|;\s*)who=([\w-]+)/.exec(req.headers.cookie || '');
  req.oidc = who ? { user: { sub: who[1] } } : undefined;
  next();
}

/** The reads the page makes of route families outside this boundary, answered as a person with a résumé and no application records. */
function standIns(web, state) {
  web.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: RIBBON } } }));
  web.get('/api/auth/user', (req, res) => res.json(req.oidc ? { authenticated: true, tenant: 'fixture', principal_id: req.oidc.user.sub } : { authenticated: false }));
  web.get('/api/career-hunter/resume/state', (_req, res) => res.json({ hasResume: true, roles: 3, indexing: false }));
  web.get('/api/career-hunter/applications', (_req, res) => res.json({ applications: [] }));
  web.get('/api/career-hunter/submission-queue', (_req, res) => res.json({ items: [] }));
  // A case can hold the list read down, or make it fail, to see what the page says meanwhile.
  web.get('/api/career-hunter/jobs', (_req, res, next) => {
    if (state.failJobs) { res.status(503).json({ error: 'read failed' }); return; }
    if (state.holdJobs) { state.holdJobs.then(() => next()); return; }
    next();
  });
}

/** Career's real compiled route modules, with only what sits outside them stood in. */
function loadRoutes() {
  return loadCompiledModules({ board: 'routes/career-board-routes.js', surface: 'routes/career-surface-routes.js', store: 'routes/career-user-store.js' }, {
    'better-sqlite3': Database, express,
    './career-authorization': { registerCareerAuthorization() {} },
    './career-autofill-routes': { loadAutofillProfile: async () => ({}) },
    './career-engine-dispatch': { runCareerCliAsync: async () => ({ started: true }), runCareerCliAwait: async () => ({ ok: true, out: '{}' }) },
    './career-engine-runner': { nativeRunInProgress: async () => false, tryAcquireRun: async () => null, releaseRun: async () => {} },
  }).modules;
}

/** The server: who is asking, the stand-ins, then the real surface and board routes at the package's own address. */
function serve(modules, state, withPage) {
  const web = express(), router = express.Router();
  const pool = { async query(sql) { return /remote_only/i.test(sql) ? { rows: [{ remote_only: false }] } : { rows: [] }; } };
  web.use(express.json()); web.use(identify);
  // A checkout under a dot folder is still served: sendFile refuses such a path unless told otherwise.
  web.use((_req, res, next) => { const send = res.sendFile; res.sendFile = (file, done) => send.call(res, file, { dotfiles: 'allow' }, done); next(); });
  standIns(web, state);
  modules.surface.registerCareerSurfaceRoutes(router);
  modules.board.registerCareerBoardRoutes(router, { pool });
  web.use('/api/career-hunter', router);
  if (withPage) web.use('/shared/ui', express.static(path.join(platform, 'src/shared/ui'), { dotfiles: 'allow' }));
  return web;
}

/** Write the corpus: one employer and one open posting per made-up job. Seeding waits for no disk flush: a temporary fixture, written many times. */
function seedCorpus(file, jobs) {
  mkdirSync(path.dirname(file), { recursive: true }); rmSync(file, { force: true });
  const corpus = new Database(file);
  corpus.pragma('synchronous = OFF'); corpus.exec('BEGIN');
  corpus.exec(schema('CORPUS_SCHEMA').replaceAll('corpus.', ''));
  const company = corpus.prepare('INSERT INTO companies(id, name) VALUES (?, ?)');
  const posting = corpus.prepare(`INSERT INTO postings_corpus(id, company_id, ats_job_id, title, url, description, location, remote, active, target_role,
    posted_date, first_seen_at, salary_min, salary_max, salary_currency, salary_period, salary_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`);
  for (const job of jobs) {
    company.run(job.id, job.company);
    posting.run(job.id, job.id, 'invented-' + job.id, job.title, `https://jobs.example.com/${job.id}`, `The made-up description of job ${job.id}. `.repeat(6), job.location, job.remote,
      job.posted, job.posted + 'T00:00:00Z', job.pay?.[0] ?? null, job.pay?.[1] ?? null, job.pay ? 'USD' : null, job.pay ? 'year' : null, job.pay ? 'posted' : null);
  }
  corpus.exec('COMMIT'); corpus.close();
}

/** Write one person's store: a made-up résumé, and every job scored, new and unsaved. */
function seedPerson(own, jobs) {
  rmSync(own.userDir, { recursive: true, force: true }); mkdirSync(own.userDir, { recursive: true });
  writeFileSync(path.join(own.userDir, 'career_db.json'), JSON.stringify({ profile: { name: 'Morgan Sample', headline: 'Made-up headline' }, roles: [{ title: 'Engineer', org: 'Sample Works', start: '2020-01', end: '2024-01' }] }));
  const db = new Database(own.userDb);
  db.pragma('synchronous = OFF');
  db.exec(schema('USER_SCHEMA'));
  require('../../lib/career-signal-migrations').migrate(db);
  const signal = db.prepare("INSERT INTO user_signals(posting_id, fit_score, ai_fit_score, ai_fit_rationale, ai_scored_at, status) VALUES (?, ?, ?, ?, ?, 'new')");
  db.exec('BEGIN');
  for (const job of jobs) signal.run(job.id, job.fit - 5, job.fit, `A made-up reason job ${job.id} fits. `.repeat(3), '2026-11-18T12:00:00Z');
  db.exec('COMMIT'); db.close();
}

/** What a case reads of, and changes in, a person's store without going through the routes. */
function storeAccess(paths) {
  return {
    /** One person's status of each job, as their store holds it. */
    signals(sub = PERSON) {
      const db = new Database(paths(sub).userDb, { readonly: true });
      try { return Object.fromEntries(db.prepare('SELECT posting_id, status FROM user_signals ORDER BY posting_id').all().map((row) => [row.posting_id, row.status])); }
      finally { db.close(); }
    },
    /** The ids one person has saved, as their board record holds them. */
    favorites(sub = PERSON) {
      try { return Object.entries(JSON.parse(readFileSync(path.join(paths(sub).userDir, 'job-board-state.json'), 'utf8')).jobs || {}).filter(([, job]) => job.favorite === true).map(([id]) => Number(id)).sort((a, b) => a - b); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    /** Move a job in one person's store directly, as another screen or the engine would: its status and whether it is saved. */
    mark(id, status, { favorite, sub = PERSON } = {}) {
      const db = new Database(paths(sub).userDb);
      try { db.prepare('UPDATE user_signals SET status=? WHERE posting_id=?').run(status, id); } finally { db.close(); }
      if (favorite !== undefined) require('../../lib/career-board-state').updateBoardState(paths(sub).userDir, id, { favorite });
    },
  };
}

/**
 * @description Start the harness: a temporary store root, the corpus, a store per person, and the server.
 * @param {{jobs?: Array<object>, page?: boolean}} [options] The corpus rows; `page` also serves the platform's shared
 *   styles, which needs OSHAL_KERNEL_PLATFORM.
 * @returns {Promise<object>} origin, state, call(), signals(), favorites(), mark(), seed(), stop().
 */
export async function deckHarness(options = {}) {
  if (options.page) assert.ok(platform, 'OSHAL_KERNEL_PLATFORM must name the kernel platform folder (refusing rather than skipping)');
  const root = mkdtempSync(path.join(tmpdir(), 'career-match-deck-'));
  const saved = { store: process.env.JOBHUNTER_STORE_ROOT, mount: process.env.OSHAL_CAREER_OWNER_MOUNT };
  // The stores here are ordinary writable files, not a published read-only generation.
  process.env.JOBHUNTER_STORE_ROOT = root; delete process.env.OSHAL_CAREER_OWNER_MOUNT;
  const modules = loadRoutes(), state = { failJobs: false, holdJobs: null }, paths = (sub) => modules.store.userPaths(sub);
  const harness = { state, root, origin: '', paths, ...storeAccess(paths) };
  /** Write the corpus and each person's store afresh. */
  harness.seed = (jobs = options.jobs || inventedJobs(6)) => { seedCorpus(paths(PERSON).corpusDb, jobs); for (const sub of [PERSON, OTHER]) seedPerson(paths(sub), jobs); };
  /** One request as a made-up person (or as nobody, with `who` null). */
  harness.call = async (method, route, body, who = PERSON) => {
    const response = await fetch(harness.origin + '/api/career-hunter' + route, { method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: 'who=' + who } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* an HTML answer has no JSON */ }
    return { code: response.status, type: response.headers.get('content-type') || '', text, body: json };
  };
  harness.stop = async () => {
    harness.server?.closeAllConnections();
    await new Promise((done) => (harness.server ? harness.server.close(done) : done()));
    for (const [key, value] of [['JOBHUNTER_STORE_ROOT', saved.store], ['OSHAL_CAREER_OWNER_MOUNT', saved.mount]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  };
  harness.seed();
  harness.server = serve(modules, state, options.page).listen(0, '127.0.0.1');
  await new Promise((done) => harness.server.once('listening', done));
  harness.origin = 'http://127.0.0.1:' + harness.server.address().port;
  return harness;
}
