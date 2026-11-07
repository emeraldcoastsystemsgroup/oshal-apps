/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Recruiters, grade F): a status change saved, then every list answered 500 "unable to open database file" on production and the screen read "All 0" over 18 saved firms. Over a disposable store laid out as the kernel pins it for a read (owner directory read-only, OSHAL_CAREER_OWNER_MOUNT=1) and written the engine's way (WAL header, nothing pending): the list opens it and shows every firm; an update through the route then leaves the file in rollback-journal mode, so the next read pin opens it, and the list shows the change. Red on the previous route: the plain read-only open fails exactly as production did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRouter, loadCompiledModules } from './helpers/career-route-harness.mjs';

/** better-sqlite3's synchronous interface over node:sqlite, as the native bridge's sqlite_compat serves it. */
class SqliteAdapter {
  constructor(filename, options = {}) {
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-recruiter-read-after-write-'));
process.env.JOBHUNTER_STORE_ROOT = root;
const routeFile = process.env.CAREER_RECRUITER_ROUTE || 'routes/career-recruiter-routes.js';
const { modules } = loadCompiledModules(
  { recruiters: routeFile, store: 'routes/career-user-store.js' },
  { 'better-sqlite3': SqliteAdapter },
);
const router = createRouter();
modules.recruiters.registerCareerRecruiterRoutes(router);
const SUB = 'person-wal';
const { userDb, userDir } = modules.store.userPaths(SUB);

/** Drive one registered route as the person and return its status and body. */
async function call(method, pathname, body = {}) {
  const found = router.find(method, pathname);
  assert.ok(found, `${method} ${pathname} is registered`);
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  await found.handler({ oidc: { user: { sub: SUB } }, body, query: {}, params: found.params, headers: {} }, res);
  return out;
}

/** The person's store as the engine leaves a write it could not switch back: WAL header, nothing pending. */
function engineWrittenStore(firms) {
  const db = new DatabaseSync(userDb);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(modules.recruiters.engineUserSchema());
  const add = db.prepare("INSERT INTO recruiter_firms (firm, bucket, status, sort_order) VALUES (?, 'Exec Search', 'To contact', ?)");
  firms.forEach((firm, i) => add.run(firm, i + 1));
  db.close();
  assert.deepEqual([...fs.readFileSync(userDb).subarray(18, 20)], [2, 2], 'the fixture store carries a WAL header');
  assert.equal(fs.existsSync(`${userDb}-wal`), false, 'and nothing pending');
}

/** Run a read the way the kernel pins it: the owner directory read-only. */
async function pinnedRead(fn) {
  process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
  fs.chmodSync(userDir, 0o555);
  try { return await fn(); } finally { fs.chmodSync(userDir, 0o755); delete process.env.OSHAL_CAREER_OWNER_MOUNT; }
}

test.after(() => { try { fs.chmodSync(userDir, 0o755); } catch { /* already writable */ } fs.rmSync(root, { recursive: true, force: true }); });

const FIRMS = Array.from({ length: 18 }, (_, i) => `Firm ${String(i + 1).padStart(2, '0')}`);

test('a read pin of a WAL-header store lists every saved firm', async () => {
  fs.mkdirSync(userDir, { recursive: true });
  engineWrittenStore(FIRMS);
  const list = await pinnedRead(() => call('GET', '/recruiters'));
  assert.equal(list.code, 200, JSON.stringify(list.body));
  assert.equal(list.body.recruiters.length, 18);
  assert.equal(fs.existsSync(`${userDb}-shm`), false, 'the read leaves the pin untouched');
});

test('an update leaves the store portable and the next read pin shows the change', async () => {
  const id = (await pinnedRead(() => call('GET', '/recruiters'))).body.recruiters[0].id;
  const saved = await call('POST', `/recruiters/${id}`, { status: 'Contacted' });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  assert.deepEqual([...fs.readFileSync(userDb).subarray(18, 20)], [1, 1], 'the write published a rollback-journal store');
  const list = await pinnedRead(() => call('GET', '/recruiters'));
  assert.equal(list.code, 200, JSON.stringify(list.body));
  assert.equal(list.body.recruiters.length, 18, 'all 18 firms still listed');
  assert.deepEqual(list.body.byStatus.map((s) => [s.status, s.n]).sort(), [['Contacted', 1], ['To contact', 17]]);
});

test('a pending WAL is never bypassed by the read', () => {
  fs.writeFileSync(`${userDb}-wal`, 'x');
  process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
  try { assert.equal(modules.recruiters.readSource(userDb), userDb); } finally {
    delete process.env.OSHAL_CAREER_OWNER_MOUNT; fs.rmSync(`${userDb}-wal`);
  }
  assert.equal(modules.recruiters.readSource(userDb), userDb, 'outside the owner mount the plain path is used');
});
