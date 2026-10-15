/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Live 2026-10-11 the Career concierge (career-hunter bot) answered 503 "required specialist context was refused" on every question: the kernel pins the owner's published generation on a read-only mount, the engine keeps the owner database in WAL mode, and SQLite cannot create the -shm a read-only WAL open needs there ("unable to open database file", SQLITE_CANTOPEN). Over a disposable mount whose owner directory is read-only and whose owner database is WAL, the snapshot and the specialist facts read the saved signals. A refusal logs one closed reason and SQLite's numeric code, never a path or SQLite text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

/** better-sqlite3's synchronous interface over node:sqlite, as the native bridge's sqlite_compat serves it. */
class SqliteAdapter {
  constructor(filename, options = {}) {
    if (options.fileMustExist && !fs.existsSync(filename)) throw new Error('SQLite database does not exist');
    this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly), enableForeignKeyConstraints: true });
  }
  exec(sql) { this.db.exec(sql); return this; }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    statement.setAllowBareNamedParameters(true);
    return { get: (...a) => statement.get(...a), all: (...a) => statement.all(...a), run: (...a) => statement.run(...a) };
  }
  pragma(sql) { return this.prepare(`PRAGMA ${sql}`).all(); }
  close() { this.db.close(); }
}

const records = [];
const originalLoad = Module._load;
Module._load = function withSqlite(request, ...rest) {
  if (request === 'better-sqlite3') return SqliteAdapter;
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error: (fields, msg) => records.push({ fields, msg }) }) };
  return originalLoad.call(this, request, ...rest);
};
let reader;
try { reader = require('../lib/native-career-read.js'); } finally { Module._load = originalLoad; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-native-wal-'));
const tenant = path.join(root, 'default'), owner = path.join(tenant, 'person-w');
const principal = { subject: 'person-w', issuer: 'https://issuer.test', id: 'p-w', tenant: 't-w', state: 'active' };
process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
process.env.JOBHUNTER_STORE_ROOT = root;
test.after(() => { fs.chmodSync(owner, 0o700); fs.rmSync(root, { recursive: true, force: true }); });

/** The engine's own schema text, as the engine creates the stores. */
function engineSchema(name) {
  const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  return engine.match(new RegExp(`\\n${name} = """([\\s\\S]*?)"""`))[1];
}

/** A saved store written the engine's way: WAL owner database, one applied posting, then closed. */
function savedWalStore() {
  fs.mkdirSync(owner, { recursive: true });
  const db = new DatabaseSync(path.join(owner, 'user-person-w.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`ATTACH DATABASE '${path.join(tenant, 'corpus.db')}' AS corpus`);
  db.exec(engineSchema('CORPUS_SCHEMA'));
  db.exec(engineSchema('USER_SCHEMA'));
  db.exec(`INSERT INTO corpus.companies (id, name) VALUES (1, 'Fixture Co');
    INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, title, active, target_role, first_seen_at)
      VALUES (7, 1, 'f-7', 'Fixture Engineer', 1, 1, date('now'));
    INSERT INTO user_signals (posting_id, fit_score, status, applied_at) VALUES (7, 80, 'applied', '2026-10-11T10:00:00Z');`);
  db.close();
  fs.writeFileSync(path.join(owner, 'career_db.json'), JSON.stringify({ roles: [{ title: 'Engineer' }], skills: {} }));
}

/** The specialist read the concierge requires, registered exactly as the package registers it. */
function specialistRead() {
  let entry;
  reader.createNativeCareerReadRoutes({
    tools: { register() {} },
    specialistContext: { register: (e) => { entry = e; } },
    intent: async () => ({ principal }),
  }, root);
  return () => entry.read({ sub: principal.subject, issuer: principal.issuer, signal: { aborted: false } });
}

test('a WAL owner database pinned read-only reads the saved signals', async () => {
  savedWalStore();
  const header = fs.readFileSync(path.join(owner, 'user-person-w.db')).subarray(18, 20);
  assert.deepEqual([...header], [2, 2], 'the fixture owner database is in WAL mode, as the engine leaves it');
  assert.equal(fs.existsSync(path.join(owner, 'user-person-w.db-shm')), false);
  fs.chmodSync(owner, 0o555);
  assert.throws(() => fs.writeFileSync(path.join(owner, 'probe'), 'x'), /EACCES|EPERM/, 'the owner pin is read-only');
  const value = reader.readCareerSnapshot(principal, root);
  assert.equal(value.source.kind, 'retained_owner_sqlite');
  assert.equal(value.signalsTotal, 1);
  assert.equal(value.pipeline.applied, 1);
  assert.equal(value.recentApplied[0].title, 'Fixture Engineer');
  assert.equal(value.profile.present, true);
  const facts = await specialistRead()();
  assert.equal(facts['signals.total'], 1);
  assert.equal(facts['pipeline.applied'], 1);
  assert.equal(facts['profile.roles'], 1);
  assert.equal(fs.existsSync(path.join(owner, 'user-person-w.db-shm')), false, 'the read leaves the pin untouched');
  assert.equal(records.length, 0);
});

test('a refused read logs one closed reason and no path or SQLite text', async () => {
  fs.renameSync(path.join(tenant, 'corpus.db'), path.join(tenant, 'corpus.saved'));
  fs.writeFileSync(path.join(tenant, 'corpus.db'), 'deliberately invalid');
  try {
    await assert.rejects(specialistRead()(), /career_saved_source_unavailable/);
  } finally {
    fs.rmSync(path.join(tenant, 'corpus.db'));
    fs.renameSync(path.join(tenant, 'corpus.saved'), path.join(tenant, 'corpus.db'));
  }
  assert.equal(records.length, 1);
  assert.equal(records[0].msg, 'Career saved-source read refused');
  assert.equal(records[0].fields.reason, 'query_failed');
  assert.equal(typeof records[0].fields.sqlite, 'number');
  assert.doesNotMatch(JSON.stringify(records[0].fields), /career-native-wal|person-w|database|corpus/);
});
