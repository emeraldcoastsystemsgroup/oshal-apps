/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | DEMO-03: Strengthen's list (GET /strengthen) on a store the native kernel mounts read-only for a read, with the shared jobs corpus read-only beside it (files 0444, folders 0555). Real: the compiled route module, the launcher's own command mapping (bin/oshal-jobhunter.js) and the Python engine over SQLite. Stood in: the logger, the caller's identity, the kernel's run list and the dispatch that would launch that same program. A person who never scanned (an empty theme table, a store still marked WAL, a store with no theme table) gets the themes counted from their own scores; a person who scanned and answered gets what they saved; a person with nothing saved gets the themes with no jobs; no read changes a byte; a store the engine may write still saves its first scan. Red on store main eb905910: the never-scanned reads (an empty theme table, a store still marked WAL) answered 500 ("attempt to write a readonly database"), the nothing-saved read answered 500 ("unable to open database file") and the store with no theme table answered every theme with no jobs.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(import.meta.dirname, '..');
const python = process.env.CAREER_TEST_PYTHON || 'python3';
const SUB = 'strengthen-sample';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-strengthen-readonly-'));
const current = { dir: '' };
let router;

/** Three made-up scored jobs: two name Kubernetes (fits 60 and 70), one Terraform, one a degree. */
const SEED = [
  'import json, sys', 'from jobhunter import config, db, gaps', 'shape = sys.argv[1]', 'db.init_db()',
  'with db.connect() as conn:',
  '    company = db.upsert_company(conn, "Sample Freight", source_list="contract")',
  '    jobs = [(60, ["No hands-on Kubernetes in production", "Terraform not shown"]), (70, ["Kubernetes at scale"]), (65, ["Requires a Master\'s degree"])]',
  '    for i, (fit, found) in enumerate(jobs):',
  '        conn.execute(f"INSERT INTO {db.corpus_table()} (company_id, ats_job_id, title, url, first_seen_at, last_seen_at, active, target_role) VALUES (?,?,?,?,?,?,1,1)", (company, str(i), "Platform Engineer", f"https://example.invalid/jobs/{i}", "2026-11-20", "2026-11-20"))',
  '        posting = conn.execute("SELECT MAX(id) id FROM postings").fetchone()["id"]',
  '        db.user_set(conn, posting, ai_fit_score=fit, ai_fit_gaps=json.dumps(found))',
  '    gaps.ensure_table(conn)',
  'if shape == "scanned":',
  '    gaps.scan()',
  '    gaps.save_answer("iac", "Wrote the Terraform for the build farm.")',
  'db._leave_portable()', 'db._portable_paths.clear()',
  'import sqlite3', 'store = sqlite3.connect(config.USER_DB)',
  'if shape == "older": store.execute("DROP TABLE gap_themes")',
  'store.execute("PRAGMA journal_mode = " + ("WAL" if shape == "still-wal" else "DELETE"))', 'store.close()',
].join('\n');

/** The engine's settings for one case's folder: the person's own store and the shared corpus beside it. */
function engineEnv(dir) {
  const person = path.join(dir, 'person');
  return {
    ...process.env, PYTHONPATH: path.join(packageRoot, 'engine'), PYTHONIOENCODING: 'utf-8', JOBHUNTER_STORE: 'sqlite',
    JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: SUB, JOBHUNTER_DATA: person, JOBHUNTER_USER_DB: path.join(person, `user-${SUB}.db`),
    JOBHUNTER_CORPUS_DB: path.join(dir, 'corpus', 'corpus.db'), JOBHUNTER_CAREER_DB: path.join(person, 'career_db.json'),
  };
}

/** The launcher's own command mapping, so the route runs the program the shipped launcher would run. */
function loadMapping() {
  const binPath = path.join(packageRoot, 'bin/oshal-jobhunter.js'), cli = new Module(binPath);
  cli.filename = binPath; cli.paths = Module._nodeModulePaths(path.dirname(binPath));
  cli._compile(fs.readFileSync(binPath, 'utf8') + '\nmodule.exports.mapping=engineRuns;', binPath);
  return cli.exports.mapping;
}

/** Career's compiled Strengthen routes with only the collaborators outside the engine stood in. */
function loadRoutes(mapping) {
  const original = Module._load;
  const engine = (args, extra = {}) => {
    const out = spawnSync(python, mapping(args[0], args.slice(1))[0], { cwd: packageRoot, encoding: 'utf8', timeout: 60000, env: { ...engineEnv(current.dir), ...extra } });
    return { ok: out.status === 0, out: out.stdout, err: out.stderr };
  };
  Module._load = function (request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {}, debug() {} }) };
    if (request === './career-user-store') return { callerSub: () => SUB };
    if (request === './career-engine-runner') return { nativeRunInProgress: async () => null };
    if (request === './career-engine-dispatch') return { runCareerCliAwait: async (_pool, sub, args, env) => { assert.equal(sub, SUB); return engine(args, env); } };
    return original.call(this, request, ...rest);
  };
  try { return require('../routes/career-strengthen-routes.js'); } finally { Module._load = original; }
}

/** A new folder for one case, seeded through the engine's own storage while it can still be written. */
function seed(name, shape) {
  current.dir = path.join(root, name);
  fs.mkdirSync(path.join(current.dir, 'person'), { recursive: true });
  fs.mkdirSync(path.join(current.dir, 'corpus'));
  const out = spawnSync(python, ['-c', SEED, shape], { cwd: packageRoot, encoding: 'utf8', timeout: 60000, env: engineEnv(current.dir) });
  assert.equal(out.status, 0, out.stderr);
  // A person with nothing saved: the shared corpus holds the jobs, the person's folder holds nothing.
  if (shape === 'nothing-saved') fs.rmSync(path.join(current.dir, 'person'), { recursive: true }), fs.mkdirSync(path.join(current.dir, 'person'));
}

/** Publish the case read-only, as the kernel mounts it for a read: files 0444, folders 0555. */
function publishReadOnly() {
  for (const folder of ['person', 'corpus'].map((name) => path.join(current.dir, name))) {
    for (const file of fs.readdirSync(folder)) fs.chmodSync(path.join(folder, file), 0o444);
    fs.chmodSync(folder, 0o555);
    assert.throws(() => fs.accessSync(folder, fs.constants.W_OK), `${folder} must refuse writes (refusing rather than passing vacuously)`);
  }
}

/** Every file of the case with its bytes' digest. */
function snapshot() {
  const files = {};
  for (const name of ['person', 'corpus']) {
    const folder = path.join(current.dir, name);
    for (const file of fs.readdirSync(folder)) files[`${name}/${file}`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, file))).digest('hex');
  }
  return files;
}

/** GET /strengthen through the compiled route. */
function list() {
  const found = router.find((entry) => entry.method === 'get' && entry.path === '/strengthen');
  assert.ok(found, 'the Strengthen list route is registered');
  return new Promise((resolve, reject) => {
    const answer = { code: 200, body: null };
    const res = { status(code) { answer.code = code; return res; }, json(body) { answer.body = body; resolve(answer); return res; } };
    Promise.resolve(found.handler({ oidc: { user: { sub: SUB } }, params: {}, query: {}, headers: {} }, res)).catch(reject);
  });
}

/** Each theme's job count, for the themes that have jobs. */
const counted = (body) => Object.fromEntries(body.themes.filter((t) => t.n_jobs > 0).map((t) => [t.key, t.n_jobs]));

before(() => {
  const routes = [];
  const add = (method) => (route, handler) => routes.push({ method, path: route, handler });
  loadRoutes(loadMapping()).registerCareerStrengthenRoutes({ get: add('get'), post: add('post') }, { pool: {} });
  router = { find: (match) => routes.find(match) };
});

after(() => {
  for (const folder of fs.readdirSync(root)) {
    for (const name of ['person', 'corpus']) fs.chmodSync(path.join(root, folder, name), 0o755);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

for (const shape of ['never-scanned', 'still-wal', 'older']) {
  test(`${shape}: a read-only store answers the themes counted from the person's own scores and writes nothing`, async () => {
    seed(shape, shape);
    publishReadOnly();
    const before = snapshot();
    const answer = await list();
    assert.equal(answer.code, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.total, 3, 'three scored jobs name a gap');
    assert.deepEqual(counted(answer.body), { k8s: 2, iac: 1, degree: 1 });
    assert.equal(answer.body.themes.find((t) => t.key === 'k8s').avg_fit, 65, 'the average fit of the two Kubernetes jobs');
    assert.ok(answer.body.themes.every((t) => t.status === 'open'), 'nothing answered yet');
    assert.deepEqual(snapshot(), before, 'the read changed no byte and left nothing beside the store or the corpus');
  });
}

test('scanned and answered: a read-only store answers the themes and the answer it saved', async () => {
  seed('scanned', 'scanned');
  publishReadOnly();
  const before = snapshot();
  const answer = await list();
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(counted(answer.body), { k8s: 2, iac: 1, degree: 1 });
  const iac = answer.body.themes.find((t) => t.key === 'iac');
  assert.equal(iac.status, 'answered');
  assert.equal(iac.response, 'Wrote the Terraform for the build farm.');
  assert.deepEqual(snapshot(), before);
});

test('nothing saved: an empty read-only folder answers the themes with no jobs and creates no store', async () => {
  seed('nothing-saved', 'nothing-saved');
  publishReadOnly();
  const before = snapshot();
  const answer = await list();
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.total, 0);
  assert.ok(answer.body.themes.length > 0, 'the themes are listed');
  assert.deepEqual(counted(answer.body), {});
  assert.deepEqual(Object.keys(before), ['corpus/corpus.db'], 'the folder holds only the shared corpus');
  assert.deepEqual(snapshot(), before, 'no store was created and the corpus is unchanged');
});

test('a store the engine may write: the first list saves its scan', async () => {
  seed('writable', 'never-scanned');
  const answer = await list();
  assert.equal(answer.code, 200, JSON.stringify(answer.body));
  assert.deepEqual(counted(answer.body), { k8s: 2, iac: 1, degree: 1 });
  const out = spawnSync(python, ['-c', 'from jobhunter import gaps\nprint(gaps.is_scanned())'], { cwd: packageRoot, encoding: 'utf8', env: engineEnv(current.dir) });
  assert.equal(out.stdout.trim(), 'True', out.stderr);
});
