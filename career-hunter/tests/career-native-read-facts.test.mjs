/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Jarvis's job questions refused with "specialist context read timed out": the specialist facts ran the full AI board ranking (2.1 to 3.0 s warm on a 2.1M-signal store) inside the kernel's 3 s deadline only to count up to 10 top matches. Over a disposable store, the facts never run the board ranking, count the board's first-page matches with its own default filters, capped at 10 (an inactive or unscored posting does not count), and agree with the full snapshot's first board page; the career_database tool still reads the board.
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
const boardReads = { count: 0 };
const originalLoad = Module._load;
Module._load = function withSqlite(request, ...rest) {
  if (request === 'better-sqlite3') return SqliteAdapter;
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error: (fields, msg) => records.push({ fields, msg }) }) };
  if (request === '../routes/career-board-feed') {
    const real = originalLoad.call(this, request, ...rest);
    return { ...real, fetchBoardPage: (...args) => { boardReads.count += 1; return real.fetchBoardPage(...args); } };
  }
  return originalLoad.call(this, request, ...rest);
};
let reader;
try { reader = require('../lib/native-career-read.js'); } finally { Module._load = originalLoad; }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-native-facts-'));
const tenant = path.join(root, 'default'), owner = path.join(tenant, 'person-f');
const principal = { subject: 'person-f', issuer: 'https://issuer.test', id: 'p-f', tenant: 't-f', state: 'active' };
process.env.OSHAL_CAREER_OWNER_MOUNT = '1';
process.env.JOBHUNTER_STORE_ROOT = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/** The engine's own schema text, as the engine creates the stores. */
function engineSchema(name) {
  const engine = fs.readFileSync(new URL('../engine/jobhunter/db.py', import.meta.url), 'utf8');
  return engine.match(new RegExp(`\\n${name} = """([\\s\\S]*?)"""`))[1];
}

/** A saved store with 12 scored active postings, one scored inactive posting and one unscored posting (scored = AI fit score, as the board ranks). */
function savedStore() {
  fs.mkdirSync(owner, { recursive: true });
  const db = new DatabaseSync(path.join(owner, 'user-person-f.db'));
  db.exec(`ATTACH DATABASE '${path.join(tenant, 'corpus.db')}' AS corpus`);
  db.exec(engineSchema('CORPUS_SCHEMA'));
  db.exec(engineSchema('USER_SCHEMA'));
  db.exec("INSERT INTO corpus.companies (id, name) VALUES (1, 'Fixture Co')");
  for (let id = 1; id <= 14; id += 1) {
    db.exec(`INSERT INTO corpus.postings_corpus (id, company_id, ats_job_id, title, active, target_role, first_seen_at)
      VALUES (${id}, 1, 'f-${id}', 'Fixture role ${id}', ${id === 13 ? 0 : 1}, 1, date('now'))`);
    db.exec(`INSERT INTO user_signals (posting_id, fit_score, ai_fit_score, status) VALUES (${id}, ${60 + id}, ${id === 14 ? 'NULL' : 60 + id}, 'new')`);
  }
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

test('the specialist facts count capped scored active matches without the board ranking', async () => {
  savedStore();
  const facts = await specialistRead()();
  assert.equal(boardReads.count, 0, 'the facts read never runs the board ranking');
  assert.equal(facts['matches.sample_count'], 10);
  assert.equal(facts['signals.total'], 14);
  assert.equal(facts['profile.roles'], 1);
  const full = reader.readCareerSnapshot(principal, root);
  assert.equal(boardReads.count, 1, 'the full snapshot still reads the board');
  assert.equal(full.topMatches.length, facts['matches.sample_count']);
  assert.equal(records.length, 0);
});
