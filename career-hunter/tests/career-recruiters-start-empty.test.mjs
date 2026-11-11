/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A new person's recruiter tracker starts empty (judge's report 2026-11-11, change 1: every new person's Recruiters list opened on eighteen firms for cleared government work, executive search and SAP that they never added). The real engine (`python -m jobhunter init`) creates a person's store on real temporary SQLite, in the per-person layout and in the single-file layout, and the compiled recruiter route reads it: no firm is listed, a second init adds none, and a person who already has firms keeps every row and every field exactly as it was. The engine module no longer carries a seed list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createRouter, loadCompiledModules, python } from './helpers/career-route-harness.mjs';

/** better-sqlite3's synchronous interface over node:sqlite, as the native bridge serves it. */
class SqliteAdapter {
  constructor(filename, options = {}) {
    if (options.fileMustExist && !fs.existsSync(filename)) throw new Error('SQLite database does not exist');
    this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly) });
  }
  exec(sql) { this.db.exec(sql); return this; }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    return { get: (...a) => statement.get(...a), all: (...a) => statement.all(...a), run: (...a) => statement.run(...a) };
  }
  pragma(sql) { return this.prepare(`PRAGMA ${sql}`).all(); }
  close() { this.db.close(); }
}

const engineDir = fileURLToPath(new URL('../engine/', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-recruiters-start-empty-'));
process.env.JOBHUNTER_STORE_ROOT = root;
const { modules } = loadCompiledModules(
  { recruiters: 'routes/career-recruiter-routes.js', store: 'routes/career-user-store.js' },
  { 'better-sqlite3': SqliteAdapter },
);
const router = createRouter();
modules.recruiters.registerCareerRecruiterRoutes(router);

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/** Run the real engine's init for one store layout; the child must exit 0. */
function engineInit(env) {
  const result = spawnSync(python, ['-m', 'jobhunter', 'init'], {
    cwd: engineDir, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', JOBHUNTER_STORE: 'sqlite', ...env },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}

/** The engine's settings for one person's store, where the routes look for it. */
function personEnv(sub) {
  const { userDb, userDir, corpusDb } = modules.store.userPaths(sub);
  fs.mkdirSync(userDir, { recursive: true });
  return { JOBHUNTER_MULTIUSER: '1', OSHAL_USER_SUB: sub, JOBHUNTER_DATA: userDir, JOBHUNTER_USER_DB: userDb, JOBHUNTER_CORPUS_DB: corpusDb };
}

/** Drive one registered route as `sub` and return its status and body. */
async function call(method, pathname, sub, body = {}) {
  const found = router.find(method, pathname);
  assert.ok(found, `${method} ${pathname} is registered`);
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  await found.handler({ oidc: { user: { sub } }, body, query: {}, params: found.params, headers: {} }, res);
  return out;
}

test('a new person whose store the engine creates has no recruiter listed, and a second start adds none', async () => {
  const env = personEnv('person-new');
  engineInit(env);
  assert.equal(fs.existsSync(env.JOBHUNTER_USER_DB), true, 'the engine created the person\'s store');
  for (const round of ['first start', 'second start']) {
    const list = await call('GET', '/recruiters', 'person-new');
    assert.equal(list.code, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.recruiters, [], round);
    assert.deepEqual(list.body.byStatus, [], round);
    engineInit(env);
  }
});

test('a person who already has recruiters keeps every row and every field through a start', async () => {
  const env = personEnv('person-with-firms');
  engineInit(env);
  for (const firm of ['Acme Search', 'Beta Partners']) {
    assert.equal((await call('POST', '/recruiters', 'person-with-firms', { firm, bucket: 'Agency', website: 'https://example.test/' })).code, 201);
  }
  const first = (await call('GET', '/recruiters', 'person-with-firms')).body.recruiters;
  assert.equal((await call('POST', `/recruiters/${first[0].id}`, 'person-with-firms', { status: 'Replied', notes: 'Call on Tuesday' })).code, 200);
  const rows = () => {
    const db = new DatabaseSync(env.JOBHUNTER_USER_DB, { readOnly: true });
    try { return db.prepare('SELECT * FROM recruiter_firms ORDER BY id').all().map((row) => ({ ...row })); } finally { db.close(); }
  };
  const before = rows();
  assert.equal(before.length, 2);
  engineInit(env);
  assert.deepEqual(rows(), before, 'nothing added, changed or removed');
  const list = (await call('GET', '/recruiters', 'person-with-firms')).body;
  assert.deepEqual(list.recruiters.map((r) => [r.firm, r.status]), [['Acme Search', 'Replied'], ['Beta Partners', 'To contact']]);
});

test('the single-file store starts with no recruiter either', () => {
  const data = path.join(root, 'single');
  fs.mkdirSync(data, { recursive: true });
  const file = path.join(data, 'jobs.db');
  for (let start = 0; start < 2; start += 1) {
    engineInit({ JOBHUNTER_MULTIUSER: '', JOBHUNTER_DATA: data, JOBHUNTER_DB: file });
    const db = new DatabaseSync(file, { readOnly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recruiter_firms').get().n, 0, `start ${start + 1}`); } finally { db.close(); }
  }
});

test('the engine module carries no recruiter seed list', () => {
  const source = fs.readFileSync(path.join(engineDir, 'jobhunter', 'db.py'), 'utf8');
  assert.doesNotMatch(source, /_RECRUITER_SEED|def seed_recruiters|clearancejobs|Korn Ferry/i);
});
