/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Career concierge refused every question with 503 "required specialist context was refused" live on 2026-10-11 for a person with no resume: the saved-source reader threw career_saved_source_unavailable whenever the owner database was missing. Over a disposable Career mount: no corpus, no owner store, and an owner store with no database each answer an empty snapshot whose notice says what to do (upload a resume, or that the corpus is not built), and the specialist facts are scalar zeros with profile.present false that the bridge's fact rules accept. A corpus that exists but is not SQLite still refuses.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A saved store with no profile (engine schemas, empty) reads normally and still carries the upload-a-resume notice; live the concierge answered "set up your profile" without naming the upload.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The reader now logs its closed refusal reason through the platform logger, which the native bridge provides; a quiet stand-in is loaded here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

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

const originalLoad = Module._load;
Module._load = function withSqlite(request, ...rest) {
  if (request === 'better-sqlite3') return SqliteAdapter;
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {} }) };
  return originalLoad.call(this, request, ...rest);
};
let reader;
try { reader = require('../lib/native-career-read.js'); } finally { Module._load = originalLoad; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-native-read-'));
const principal = { subject: 'person-a', issuer: 'https://issuer.test', id: 'p-1', tenant: 't-1', state: 'active' };
process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
process.env.JOBHUNTER_STORE_ROOT = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/** The bridge's own fact rule: every value null, boolean or a finite number. */
function scalarFacts(facts) {
  assert.deepEqual(Object.keys(facts).sort(), [...reader.FACTS].sort());
  for (const [key, value] of Object.entries(facts)) {
    assert.ok(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)), `${key}=${value}`);
  }
}

/** The specialist read the concierge requires, registered exactly as the package registers it. */
function specialistRead() {
  let entry;
  const ctx = {
    tools: { register() {} },
    specialistContext: { register: (e) => { entry = e; } },
    intent: async () => ({ principal }),
  };
  reader.createNativeCareerReadRoutes(ctx, root);
  return () => entry.read({ sub: principal.subject, issuer: principal.issuer, signal: { aborted: false } });
}

test('with no corpus the snapshot is empty and says the corpus is not built', () => {
  const value = reader.readCareerSnapshot(principal, root);
  assert.equal(value.source.reason, 'no_corpus');
  assert.match(value.notice, /job corpus has not been built/);
  assert.equal(value.signalsTotal, 0);
});

test('with a corpus but no owner store or database, the snapshot tells the person to upload a resume', async () => {
  fs.mkdirSync(path.join(root, 'default'), { recursive: true });
  new DatabaseSync(path.join(root, 'default', 'corpus.db')).close();
  const none = reader.readCareerSnapshot(principal, root);
  assert.equal(none.source.reason, 'no_owner_store');
  assert.match(none.notice, /Upload one on Career/);
  fs.mkdirSync(path.join(root, 'default', 'person-a'));
  const empty = reader.readCareerSnapshot(principal, root);
  assert.equal(empty.source.reason, 'no_owner_database');
  assert.equal(empty.profile.present, false);
  assert.deepEqual(empty.topMatches, []);
  const facts = await specialistRead()();
  scalarFacts(facts);
  assert.equal(facts['profile.present'], false);
  assert.equal(facts['signals.total'], 0);
  assert.equal(facts['source.owner_modified_ms'], null);
  assert.equal(fs.existsSync(path.join(root, 'default', 'person-a', 'user-person-a.db')), false, 'a read never creates a store');
});

/** The engine's own schema text, as the engine creates the stores. */
function engineSchema(name) {
  const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  return engine.match(new RegExp(`\\n${name} = \"\"\"([\\s\\S]*?)\"\"\"`))[1];
}

test('a saved store with no profile yet reads normally and still says to upload a resume', () => {
  // The engine's schemas name the attached corpus, exactly as the engine creates the pair.
  const owner = new DatabaseSync(path.join(root, 'default', 'person-a', 'user-person-a.db'));
  owner.exec(`ATTACH DATABASE '${path.join(root, 'default', 'corpus.db')}' AS corpus`);
  owner.exec(engineSchema('CORPUS_SCHEMA'));
  owner.exec(engineSchema('USER_SCHEMA'));
  owner.close();
  const value = reader.readCareerSnapshot(principal, root);
  assert.equal(value.source.kind, 'retained_owner_sqlite');
  assert.equal(value.profile.present, false);
  assert.equal(value.signalsTotal, 0);
  assert.match(value.notice, /Upload one on Career/);
  fs.rmSync(path.join(root, 'default', 'person-a', 'user-person-a.db'));
});

test('a corpus that exists but is not SQLite still refuses', () => {
  fs.writeFileSync(path.join(root, 'default', 'corpus.db'), 'deliberately invalid');
  new DatabaseSync(path.join(root, 'default', 'person-a', 'user-person-a.db')).close();
  assert.throws(() => reader.readCareerSnapshot(principal, root), /career_saved_source_unavailable/);
});
