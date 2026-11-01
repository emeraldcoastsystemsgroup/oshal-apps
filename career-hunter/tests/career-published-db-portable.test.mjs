/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A person's database, once the engine closes it, opens from a read-only directory: the kernel publishes it and mounts it read-only for reads, and a WAL file with no side files answered "unable to open database file".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function python(script, env) {
  const done = spawnSync('python3', ['-c', script], { cwd: path.join(packageRoot, 'engine'), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(done.status, 0, done.stderr);
  return done.stdout.trim();
}

test('a closed person database opens from a read-only directory', (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'career-portable-'));
  t.after(() => { fs.chmodSync(data, 0o700); fs.rmSync(data, { recursive: true, force: true }); });
  const env = { JOBHUNTER_MULTIUSER: '1', JOBHUNTER_DATA: data, JOBHUNTER_USER_SUB: 'guest-visitor-test',
    JOBHUNTER_USER_DB: path.join(data, 'user.db'), JOBHUNTER_CORPUS_DB: path.join(data, 'corpus.db') };
  python('from jobhunter import db\nwith db.connect() as c:\n    c.execute("CREATE TABLE IF NOT EXISTS probe (id INTEGER)")\n    c.execute("INSERT INTO probe VALUES (1)")', env);
  const header = fs.readFileSync(env.JOBHUNTER_USER_DB).subarray(18, 20);
  assert.deepEqual([...header], [1, 1], 'the file is left in rollback-journal mode');
  assert.ok(!fs.existsSync(`${env.JOBHUNTER_USER_DB}-wal`));
  fs.chmodSync(data, 0o500);
  const read = python(`import sqlite3\nc = sqlite3.connect("file:${env.JOBHUNTER_USER_DB}?mode=ro", uri=True)\nprint(c.execute("SELECT count(*) FROM probe").fetchone()[0])`, {});
  assert.equal(read, '1');
  fs.chmodSync(data, 0o700);
  python('from jobhunter import db\nwith db.connect() as c:\n    assert c.execute("PRAGMA main.journal_mode").fetchone()[0] == "wal"', env);
});
