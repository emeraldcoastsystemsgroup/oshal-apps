/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A read of a person's published store: the engine opens it read-only in any journal mode and shape, and the board answers an older store instead of a 500.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isolateRunnerEnv, loadCompiledModules } from './helpers/career-route-harness.mjs';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = path.join(packageRoot, '..', 'scripts', 'toolchain', 'package.json');
const require = createRequire(fs.existsSync(toolchain) ? toolchain : import.meta.url);

test('an engine read opens a read-only store in any journal mode and shape and leaves it alone', () => {
  const result = spawnSync('python3', [path.join(packageRoot, 'tests', 'career-read-only-store-contract.py')], { cwd: packageRoot, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).findLast(entry => entry.startsWith('CAREER_READ_ONLY_STORE='));
  const report = JSON.parse(line.slice('CAREER_READ_ONLY_STORE='.length));
  for (const name of ['rollback', 'still-wal', 'older']) {
    assert.equal(report[name].fit, 77, `${name}: the person's fit reads`);
    assert.equal(report[name].unchanged, true, `${name}: the read did not change the store`);
    assert.deepEqual(report[name].leftBeside, [], `${name}: the read left nothing beside it`);
  }
});

test('the board answers a store older than a column it selects, and a current store is left as it is', async () => {
  const Database = require('better-sqlite3');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-older-store-'));
  const restore = isolateRunnerEnv(root);
  const { modules: { store, board } } = loadCompiledModules(
    { store: 'routes/career-user-store.js', board: 'routes/career-board-routes.js' }, { 'better-sqlite3': Database });
  const paths = store.userPaths('older-owner');
  fs.mkdirSync(paths.userDir, { recursive: true });
  const corpus = new Database(paths.corpusDb);
  corpus.exec(`CREATE TABLE postings_corpus (id INTEGER PRIMARY KEY, company_id INTEGER, title TEXT, active INTEGER); CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);`);
  corpus.close();
  const older = new Database(paths.userDb);
  older.exec('CREATE TABLE user_signals (posting_id INTEGER PRIMARY KEY, fit_score INTEGER, ai_fit_score INTEGER)');
  older.close();
  const before = fs.readFileSync(paths.userDb);
  const db = store.openUserDb('older-owner');
  try {
    assert.equal(db.prepare('SELECT COUNT(s.ai_input_fingerprint) AS n FROM user_signals s').get().n, 0, 'the column reads as empty');
    assert.throws(() => db.exec('DELETE FROM user_signals'), 'the read stays read-only');
  } finally { db.close(); }
  assert.deepEqual(fs.readFileSync(paths.userDb), before, 'the store itself did not change');
  const current = new Database(paths.userDb);
  current.exec('ALTER TABLE user_signals ADD COLUMN ai_input_fingerprint TEXT');
  current.exec("INSERT INTO user_signals (posting_id, ai_input_fingerprint) VALUES (1, 'kept')");
  current.close();
  const reopened = store.openUserDb('older-owner');
  try {
    assert.equal(reopened.prepare('SELECT ai_input_fingerprint AS f FROM user_signals').get().f, 'kept');
    assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM temp.sqlite_master WHERE name='user_signals'").get().n, 0, 'a current store gets no shadow');
  } finally { reopened.close(); }
  assert.equal(typeof board.registerCareerBoardRoutes, 'function');
  restore?.();
  fs.rmSync(root, { recursive: true, force: true });
});
