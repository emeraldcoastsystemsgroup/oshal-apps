/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A person's database, once the engine closes it, opens from a read-only directory: the kernel publishes it and mounts it read-only for reads, and a WAL file with no side files answered "unable to open database file".
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The file leaves WAL when the process ends and never when one connection closes: scoring workers locked each other out.
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

test('scoring workers sharing a person database never lock each other out, and it still closes portable', (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'career-portable-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const env = { JOBHUNTER_MULTIUSER: '1', JOBHUNTER_DATA: data, JOBHUNTER_USER_SUB: 'guest-visitor-test',
    JOBHUNTER_USER_DB: path.join(data, 'user.db'), JOBHUNTER_CORPUS_DB: path.join(data, 'corpus.db') };
  python([
    'import concurrent.futures as cf',
    'from jobhunter import db',
    'with db.connect() as c:',
    '    c.execute("CREATE TABLE IF NOT EXISTS probe (id INTEGER)")',
    'def work(n):',
    '    for _ in range(25):',
    '        with db.connect() as c:',
    '            c.execute("INSERT INTO probe VALUES (?)", (n,))',
    '    return n',
    'with cf.ThreadPoolExecutor(max_workers=8) as ex:',
    '    assert sorted(ex.map(work, range(8))) == list(range(8))',
    'with db.connect() as c:',
    '    assert c.execute("SELECT count(*) FROM probe").fetchone()[0] == 200',
    // The cause itself: a closed connection must not switch the mode while the process, and other workers, go on.
    `assert open(${JSON.stringify(env.JOBHUNTER_USER_DB)}, "rb").read(20)[18:20] == bytes([2, 2]), "a closed connection left WAL mid-process"`,
  ].join('\n'), env);
  const header = fs.readFileSync(env.JOBHUNTER_USER_DB).subarray(18, 20);
  assert.deepEqual([...header], [1, 1], 'the process ended and left it in rollback-journal mode');
  assert.ok(!fs.existsSync(`${env.JOBHUNTER_USER_DB}-wal`));
});
