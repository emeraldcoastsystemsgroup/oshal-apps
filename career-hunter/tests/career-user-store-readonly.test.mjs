/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard native checkpointed-WAL HTTP store reads, pending WAL visibility, mutable-store locking, attached-corpus write refusal and connection cleanup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const opened = [];
class SqliteAdapter {
  constructor(filename, options = {}) {
    this.filename = filename;
    this.db = new DatabaseSync(filename, { readOnly: Boolean(options.readonly) });
    this.closed = false;
    opened.push(this);
  }
  exec(sql) { this.db.exec(sql); }
  prepare(sql) { return this.db.prepare(sql); }
  pragma(sql) { return this.prepare(`PRAGMA ${sql}`).all(); }
  transaction(fn) { return (...args) => {
    this.exec('BEGIN');
    try { const result = fn(...args); this.exec('COMMIT'); return result; }
    catch (err) { this.exec('ROLLBACK'); throw err; }
  }; }
  close() { this.db.close(); this.closed = true; }
}
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === 'better-sqlite3') return SqliteAdapter;
  if (request === '@/shared/logger') return { createChildLogger: () => ({ warn() {}, error() {} }) };
  if (request === '@/shared/middleware/authz') return { getTrustedServiceUserSub: () => null };
  if (request === '@/app/routes/caller-sub') return { callerSub: () => null };
  return load.call(this, request, ...args);
};
let store;
try { store = require('../routes/career-user-store.js'); } finally { Module._load = load; }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-route-read-'));
  const owner = path.join(root, 'default', 'fixture-owner');
  fs.mkdirSync(owner, { recursive: true });
  const userDb = path.join(owner, 'user-fixture-owner.db');
  const corpus = path.join(root, 'default', 'corpus.db');
  let db = new DatabaseSync(corpus);
  db.exec('CREATE TABLE postings_corpus(id INTEGER PRIMARY KEY); INSERT INTO postings_corpus VALUES(7)');
  db.close();
  db = new DatabaseSync(userDb);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE user_signals(posting_id INTEGER PRIMARY KEY,status TEXT,notes TEXT); INSERT INTO user_signals(posting_id,status) VALUES(7,'new')");
  db.close();
  const previous = [process.env.JOBHUNTER_STORE_ROOT, process.env.OSHAL_CAREER_OWNER_MOUNT];
  process.env.JOBHUNTER_STORE_ROOT = root;
  process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
  return { root, owner, userDb, corpus, cleanup() {
    fs.chmodSync(owner, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
    for (const [i, name] of ['JOBHUNTER_STORE_ROOT', 'OSHAL_CAREER_OWNER_MOUNT'].entries()) {
      if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
    }
  } };
}

test('native route connection reads checkpointed WAL without sidecars and rejects writes to either database', () => {
  const f = fixture();
  try {
    const before = [fs.readFileSync(f.userDb), fs.readFileSync(f.corpus)];
    assert.deepEqual([...before[0].subarray(18, 20)], [2, 2]);
    fs.chmodSync(f.owner, 0o555);
    const db = store.openUserDb('fixture-owner');
    try {
      assert.match(db.filename, /\?immutable=1$/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_signals').get().n, 1);
      assert.equal(db.prepare('SELECT id FROM corpus.postings_corpus').get().id, 7);
      assert.throws(() => db.exec('DELETE FROM user_signals'), /readonly/i);
      assert.throws(() => db.exec('DELETE FROM corpus.postings_corpus'), /readonly/i);
    } finally { db.close(); }
    assert.deepEqual(fs.readFileSync(f.userDb), before[0]);
    assert.deepEqual(fs.readFileSync(f.corpus), before[1]);
    assert.deepEqual(fs.readdirSync(f.owner), ['user-fixture-owner.db']);
  } finally { f.cleanup(); }
});

test('a nonempty WAL uses ordinary locking and includes its uncheckpointed committed rows', () => {
  const f = fixture();
  const writer = new DatabaseSync(f.userDb);
  try {
    writer.exec("PRAGMA wal_autocheckpoint=0; INSERT INTO user_signals(posting_id,status) VALUES(8,'generated')");
    assert.ok(fs.statSync(`${f.userDb}-wal`).size > 0);
    const db = store.openUserDb('fixture-owner');
    try {
      assert.equal(db.filename, f.userDb);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_signals').get().n, 2);
    } finally { db.close(); }
  } finally { writer.close(); f.cleanup(); }
});

test('mutable legacy read connections retain ordinary locking', () => {
  const f = fixture();
  try {
    delete process.env.OSHAL_CAREER_OWNER_MOUNT;
    const db = store.openUserDb('fixture-owner');
    try { assert.equal(db.filename, f.userDb); } finally { db.close(); }
  } finally { f.cleanup(); }
});

test('writable connections remain writable and perform their compatibility migration', () => {
  const f = fixture();
  try {
    const db = store.openUserDb('fixture-owner', false);
    try {
      assert.equal(db.filename, f.userDb);
      db.exec("INSERT INTO user_signals(posting_id,status) VALUES(8,'new')");
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_signals').get().n, 2);
      assert.ok(db.prepare('PRAGMA table_info(user_signals)').all().some(r => r.name === 'apply_claim_token'));
    } finally { db.close(); }
  } finally { f.cleanup(); }
});

test('attachment failure closes the opened owner connection', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.corpus, 'invalid sqlite');
    const start = opened.length;
    assert.throws(() => store.openUserDb('fixture-owner'));
    assert.equal(opened.length, start + 1);
    assert.equal(opened.at(-1).closed, true);
  } finally { f.cleanup(); }
});
