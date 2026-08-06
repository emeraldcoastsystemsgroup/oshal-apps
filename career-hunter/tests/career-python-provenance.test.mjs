/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real Python storage chokepoint and prove manual status updates cannot downgrade stronger application provenance.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove same-rank multiuser and legacy replays retain non-null task and confirmation evidence while preserving the first applied timestamp.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const program = String.raw`
import json
import sqlite3
from jobhunter import db

db.config.POSTGRES = False
db.config.MULTIUSER = True
conn = sqlite3.connect(':memory:')
conn.row_factory = sqlite3.Row
conn.execute('''CREATE TABLE user_signals (
  posting_id INTEGER PRIMARY KEY, status TEXT, applied_at TEXT,
  application_source TEXT, application_task_id TEXT, confirmation_path TEXT
)''')
conn.execute('''INSERT INTO user_signals VALUES
  (1, 'applied', '2026-01-01T00:00:00Z', 'verified-submission', 'apply-proof', '/proof.png')''')
db.set_status(conn, 1, 'applied')
db.set_status(conn, 1, 'applied', application_source='verified-submission',
              application_task_id=None, confirmation_path=None)
db.set_status(conn, 2, 'applied')
db.set_status(conn, 2, 'applied', application_source='worker-reported',
              application_task_id='apply-worker')
rows = [dict(row) for row in conn.execute(
  'SELECT * FROM user_signals ORDER BY posting_id').fetchall()]

db.config.MULTIUSER = False
legacy = sqlite3.connect(':memory:')
legacy.row_factory = sqlite3.Row
legacy.execute('''CREATE TABLE postings (
  id INTEGER PRIMARY KEY, status TEXT, applied_at TEXT,
  application_source TEXT, application_task_id TEXT, confirmation_path TEXT
)''')
legacy.execute('''INSERT INTO postings VALUES
  (7, 'applied', '2026-02-01T00:00:00Z', 'verified-submission',
   'apply-legacy-proof', '/legacy-proof.png')''')
db.set_status(legacy, 7, 'applied', application_source='verified-submission',
              application_task_id=None, confirmation_path=None)
legacy_row = dict(legacy.execute('SELECT * FROM postings WHERE id=7').fetchone())
print(json.dumps({'multiuser': rows, 'legacy': legacy_row}))
`;

test('Python status writes preserve and upgrade provenance monotonically', () => {
  const result = spawnSync(python, ['-c', program], {
    cwd: packageRoot,
    env: { ...process.env, PYTHONPATH: join(packageRoot, 'engine') },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  const rows = output.multiuser;
  assert.deepEqual(rows[0], {
    posting_id: 1, status: 'applied', applied_at: '2026-01-01T00:00:00Z',
    application_source: 'verified-submission', application_task_id: 'apply-proof',
    confirmation_path: '/proof.png',
  });
  assert.equal(rows[1].application_source, 'worker-reported');
  assert.equal(rows[1].application_task_id, 'apply-worker');
  assert.deepEqual(output.legacy, {
    id: 7, status: 'applied', applied_at: '2026-02-01T00:00:00Z',
    application_source: 'verified-submission', application_task_id: 'apply-legacy-proof',
    confirmation_path: '/legacy-proof.png',
  });
});
