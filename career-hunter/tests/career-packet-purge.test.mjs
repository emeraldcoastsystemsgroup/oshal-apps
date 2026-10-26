/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify the seven-day generated-queue purge, preview count fence, packet cleanup and status isolation against a disposable SQLite store.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = join(packageRoot, 'engine');
const python = process.env.JOBHUNTER_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const program = String.raw`
import json, os, sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from jobhunter import config, db, packets

root = Path(os.environ['CAREER_PURGE_FIXTURE'])
owner_apps = root / 'owner-applications'
owner_apps.mkdir(parents=True)
config.MULTIUSER = True
config.POSTGRES = False
config.APP_DIR = owner_apps
conn = sqlite3.connect(root / 'owner.db')
conn.row_factory = sqlite3.Row
conn.execute('CREATE TABLE user_signals (posting_id INTEGER PRIMARY KEY, status TEXT, generated_at TEXT)')
now = datetime.now(timezone.utc)
stamp = lambda days: (now - timedelta(days=days)).isoformat()
conn.executemany('INSERT INTO user_signals VALUES (?, ?, ?)', [
    (1, 'generated', stamp(9)),
    (2, 'generated', stamp(8)),
    (3, 'generated', stamp(1)),
    (4, 'applied', stamp(20)),
    (5, 'promoted', stamp(20)),
    (6, 'new', stamp(20)),
    (7, 'dismissed', stamp(20)),
])

@contextmanager
def connect():
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise

db.connect = connect
packet = owner_apps / 'FixtureCo__1'
packet.mkdir()
(packet / 'application.json').write_text(json.dumps({'posting_id': 1}), encoding='utf-8')

other_db = sqlite3.connect(root / 'other.db')
other_db.execute('CREATE TABLE user_signals (posting_id INTEGER PRIMARY KEY, status TEXT, generated_at TEXT)')
other_db.execute('INSERT INTO user_signals VALUES (1, ?, ?)', ('generated', stamp(30)))
other_db.commit()
other_db.close()
other_packet = root / 'other-applications' / 'OtherCo__1'
other_packet.mkdir(parents=True)
(other_packet / 'application.json').write_text(json.dumps({'posting_id': 1}), encoding='utf-8')

cutoff = (now - timedelta(days=7)).isoformat()
preview = packets.preview_generated_before(cutoff)
mismatch = packets.purge_generated_before(cutoff, 1)
after_mismatch = int(conn.execute('SELECT COUNT(*) FROM user_signals WHERE status="generated"').fetchone()[0])
packet_after_mismatch = packet.is_dir()
purged = packets.purge_generated_before(cutoff, 2)
remaining = [tuple(row) for row in conn.execute('SELECT posting_id, status FROM user_signals ORDER BY posting_id')]
other_db = sqlite3.connect(root / 'other.db')
other_row = tuple(other_db.execute('SELECT posting_id, status FROM user_signals').fetchone())
other_db.close()

print(json.dumps({
    'preview': preview,
    'mismatch': mismatch,
    'afterMismatch': after_mismatch,
    'packetAfterMismatch': packet_after_mismatch,
    'purged': purged,
    'remaining': remaining,
    'packetRemoved': not packet.exists(),
    'otherRow': other_row,
    'otherPacketPreserved': other_packet.is_dir(),
}))
conn.close()
`;

test('preview and permanent purge touch only old generated rows in the current user store', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'career-packet-purge-'));
  try {
    const result = spawnSync(python, ['-c', program], {
      cwd: packageRoot,
      env: {
        ...process.env,
        PYTHONPATH: engineRoot,
        JOBHUNTER_STORE: 'sqlite',
        JOBHUNTER_MULTIUSER: '1',
        JOBHUNTER_DATA: fixture,
        JOBHUNTER_USER_DB: join(fixture, 'owner.db'),
        JOBHUNTER_CORPUS_DB: join(fixture, 'corpus.db'),
        JOBHUNTER_APP_DIR: join(fixture, 'owner-applications'),
        CAREER_PURGE_FIXTURE: fixture,
      },
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.preview.ok, true);
    assert.equal(output.preview.readyRows, 2);
    assert.equal(output.preview.packetDirectories, 1);
    assert.equal(output.preview.readyRowsWithoutPacket, 1);
    assert.equal(output.mismatch.code, 'count-changed');
    assert.equal(output.afterMismatch, 3, 'count mismatch leaves every Ready row in place');
    assert.equal(output.packetAfterMismatch, true, 'count mismatch leaves packet files in place');
    assert.equal(output.purged.ok, true);
    assert.equal(output.purged.purgedReadyRows, 2);
    assert.equal(output.purged.removedPacketDirectories, 1);
    assert.deepEqual(output.remaining, [[3, 'generated'], [4, 'applied'], [5, 'promoted'], [6, 'new'], [7, 'dismissed']]);
    assert.equal(output.packetRemoved, true);
    assert.deepEqual(output.otherRow, [1, 'generated']);
    assert.equal(output.otherPacketPreserved, true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
