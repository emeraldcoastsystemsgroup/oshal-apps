/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add recruiter answered 404 {error:'no data'} live on 2026-10-11 for a person who had not ingested a resume: openUserDb returns null until the shared corpus AND the per-user database exist. The compiled routes are driven over a disposable store with neither: the first POST creates the caller's database with the engine's own USER_SCHEMA and answers 201, the list shows it, another person sees nothing, and an edit or delete with no store answers 404 without creating one. SQLite is node:sqlite behind the same better-sqlite3 interface the native bridge provides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRouter, loadCompiledModules } from './helpers/career-route-harness.mjs';

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-recruiter-first-write-'));
process.env.JOBHUNTER_STORE_ROOT = root;
const { modules } = loadCompiledModules(
  { recruiters: 'routes/career-recruiter-routes.js', store: 'routes/career-user-store.js' },
  { 'better-sqlite3': SqliteAdapter },
);
const router = createRouter();
modules.recruiters.registerCareerRecruiterRoutes(router);

/** Drive one registered route as `sub` and return its status and body. */
async function call(method, pathname, sub, body = {}) {
  const found = router.find(method, pathname);
  assert.ok(found, `${method} ${pathname} is registered`);
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  await found.handler({ oidc: { user: { sub } }, body, query: {}, params: found.params, headers: {} }, res);
  return out;
}

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('the first recruiter a person adds creates their store with the engine schema', async () => {
  const { userDb } = modules.store.userPaths('person-a');
  assert.equal(fs.existsSync(userDb), false, 'no store before the first write');
  assert.equal(fs.existsSync(path.join(root, 'default', 'corpus.db')), false, 'and no shared corpus at all');
  const added = await call('POST', '/recruiters', 'person-a', { firm: 'Acme Search', bucket: 'Exec Search' });
  assert.equal(added.code, 201, JSON.stringify(added.body));
  assert.equal(added.body.ok, true);
  const db = new DatabaseSync(userDb, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  db.close();
  assert.ok(tables.includes('recruiter_firms') && tables.includes('user_signals'), `engine USER_SCHEMA applied: ${tables}`);
});

test('the list shows it, a second add follows it, and another person sees nothing', async () => {
  await call('POST', '/recruiters', 'person-a', { firm: 'Beta Partners' });
  const list = await call('GET', '/recruiters', 'person-a');
  assert.equal(list.code, 200);
  assert.deepEqual(list.body.recruiters.map((r) => r.firm), ['Acme Search', 'Beta Partners']);
  const other = await call('GET', '/recruiters', 'person-b');
  assert.deepEqual(other.body.recruiters, []);
  assert.equal(other.body.empty, true);
});

test('editing or deleting with no store answers 404 and creates nothing', async () => {
  const { userDb } = modules.store.userPaths('person-c');
  assert.equal((await call('POST', '/recruiters/1', 'person-c', { status: 'Contacted' })).code, 404);
  assert.equal((await call('DELETE', '/recruiters/1', 'person-c')).code, 404);
  assert.equal(fs.existsSync(userDb), false);
});

test('the schema comes from the engine module itself', () => {
  const schema = modules.recruiters.engineUserSchema();
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_signals/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS recruiter_firms/);
});
