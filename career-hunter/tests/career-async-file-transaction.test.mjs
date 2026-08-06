/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard Resume Studio filesystem work against synchronous regressions and exercise exact asynchronous rollback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_FILE_API = /\b(?:access|exists|readFile|readdir|writeFile|rename|unlink|rm|mkdir)Sync\b/;

async function readPackageFile(relativePath) {
  return fs.readFile(join(packageRoot, relativePath), 'utf8');
}

test('Resume Studio source contains no synchronous filesystem boundary', async () => {
  const transaction = await readPackageFile('src-routes/career-file-transaction.ts');
  const studio = await readPackageFile('src-routes/career-resume-studio-routes.ts');
  assert.doesNotMatch(transaction, SYNC_FILE_API);
  assert.doesNotMatch(studio, SYNC_FILE_API);
  assert.match(transaction, /promises as fs/);
  for (const operation of ['snapshotFilesAsync', 'writeFileAtomicAsync', 'restoreFilesAsync']) {
    assert.match(studio, new RegExp(`await ${operation}\\b`), `${operation} is not awaited`);
  }
});

test('built transaction helpers restore exact bytes and remove newly-created files', async () => {
  const transaction = require('../routes/career-file-transaction.js');
  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'career-async-transaction-'));
  const existing = join(fixtureRoot, 'existing.json');
  const created = join(fixtureRoot, 'created.json');
  try {
    await fs.writeFile(existing, Buffer.from([0, 1, 2, 255]));
    const snapshots = await transaction.snapshotFilesAsync([existing, created]);
    await transaction.writeFileAtomicAsync(existing, 'replacement');
    await transaction.writeFileAtomicAsync(created, 'temporary');
    await transaction.restoreFilesAsync(snapshots);
    assert.deepEqual(await fs.readFile(existing), Buffer.from([0, 1, 2, 255]));
    await assert.rejects(fs.access(created), { code: 'ENOENT' });
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('failed atomic replacement removes its same-directory temporary file', async () => {
  const transaction = require('../routes/career-file-transaction.js');
  const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'career-atomic-cleanup-'));
  const directoryTarget = join(fixtureRoot, 'occupied');
  try {
    await fs.mkdir(directoryTarget);
    await assert.rejects(transaction.writeFileAtomicAsync(directoryTarget, 'cannot replace directory'));
    const leftovers = (await fs.readdir(fixtureRoot)).filter((name) => name.startsWith('.occupied.'));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});
