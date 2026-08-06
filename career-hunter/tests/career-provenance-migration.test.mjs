/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the SQLite compatibility migration labels only link-free in-store confirmation evidence as verified and conservatively classifies older applied rows.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Prove historical free-form notes remain unverified because they carry no task-bound submission attestation.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const storePath = require('../lib/user-store-path.js');
const originalLoad = Module._load;
const savedStoreRoot = process.env.JOBHUNTER_STORE_ROOT;
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-provenance-migration-'));
const databases = new Map();
process.env.JOBHUNTER_STORE_ROOT = fixtureRoot;

/** Dependency-free better-sqlite3 double implementing only the migration's statements. */
class FixtureDatabase {
  constructor(filePath) {
    this.state = databases.get(filePath) || { columns: new Set(), rows: [] };
    databases.set(filePath, this.state);
  }

  pragma() {}
  close() {}
  transaction(callback) { return () => callback(); }

  exec(sql) {
    if (/^ATTACH DATABASE/.test(sql)) return;
    const added = sql.match(/ALTER TABLE user_signals ADD COLUMN (\w+)/)?.[1];
    if (added) { this.state.columns.add(added); return; }
    throw new Error(`unexpected fixture exec: ${sql}`);
  }

  prepare(sql) {
    if (sql === 'PRAGMA table_info(user_signals)') {
      return { all: () => [...this.state.columns].map((name) => ({ name })) };
    }
    if (sql.includes("WHERE status='applied' AND application_source IS NULL")) {
      return { all: () => this.state.rows.filter((row) => (
        row.status === 'applied' && row.application_source == null
      )).map((row) => ({ ...row })) };
    }
    if (sql === 'UPDATE user_signals SET application_source=? WHERE posting_id=?') {
      return { run: (source, postingId) => {
        const row = this.state.rows.find((candidate) => candidate.posting_id === postingId);
        if (row) row.application_source = source;
        return { changes: row ? 1 : 0 };
      } };
    }
    throw new Error(`unexpected fixture prepare: ${sql}`);
  }
}

Module._load = function loadWithUserStoreStubs(request, ...rest) {
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === '@/app/routes/caller-sub') return { callerSub: () => null };
  if (request === 'better-sqlite3') return FixtureDatabase;
  return originalLoad.call(this, request, ...rest);
};

const userStore = require('../routes/career-user-store.js');

after(() => {
  Module._load = originalLoad;
  if (savedStoreRoot === undefined) delete process.env.JOBHUNTER_STORE_ROOT;
  else process.env.JOBHUNTER_STORE_ROOT = savedStoreRoot;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Create one legacy-shape user database plus the shared attach target. */
function seedUser(userSub, rows) {
  const layout = storePath.resolveUserStoreLayout(fixtureRoot, 'default', userSub);
  writeFileSync(storePath.resolveContainedPath(layout.tenantDir, 'corpus.db'), 'fixture');
  writeFileSync(layout.userDb, 'fixture');
  databases.set(layout.userDb, {
    columns: new Set(['posting_id', 'status', 'confirmation_path', 'notes']),
    rows: rows.map((row) => ({
      posting_id: row.id, status: 'applied', confirmation_path: row.confirmationPath ?? null,
      notes: row.notes ?? null, application_source: null, application_task_id: null,
    })),
  });
  return layout;
}

/** Read migrated provenance directly from the dependency-free database state. */
function readSources(userDb) {
  return databases.get(userDb).rows.map((row) => ({
    posting_id: row.posting_id,
    application_source: row.application_source,
    application_task_id: row.application_task_id,
  })).sort((left, right) => left.posting_id - right.posting_id);
}

test('historical migration trusts contained evidence but not notes or evidence-free rows', () => {
  const userSub = 'provenance-history';
  const layout = storePath.resolveUserStoreLayout(fixtureRoot, 'default', userSub);
  const proof = join(layout.userDir, 'applications', 'proof.png');
  mkdirSync(join(layout.userDir, 'applications'), { recursive: true });
  writeFileSync(proof, 'proof');
  const outside = join(fixtureRoot, 'outside-proof.png');
  writeFileSync(outside, 'outside');
  const seeded = seedUser(userSub, [
    { id: 1, confirmationPath: proof },
    { id: 2, confirmationPath: outside, notes: 'worker said submitted' },
    { id: 3 },
  ]);
  const handle = userStore.openUserDb(userSub);
  assert.ok(handle);
  handle.close();
  assert.deepEqual(readSources(seeded.userDb), [
    { posting_id: 1, application_source: 'verified-submission', application_task_id: null },
    { posting_id: 2, application_source: 'unverified', application_task_id: null },
    { posting_id: 3, application_source: 'unverified', application_task_id: null },
  ]);
});

test('historical migration rejects a confirmation reached through a symlink', (context) => {
  const userSub = 'provenance-symlink';
  const layout = storePath.resolveUserStoreLayout(fixtureRoot, 'default', userSub);
  const realDir = join(layout.userDir, 'real');
  const linkedDir = join(layout.userDir, 'linked');
  mkdirSync(realDir, { recursive: true });
  writeFileSync(join(realDir, 'proof.png'), 'proof');
  try { symlinkSync(realDir, linkedDir, 'junction'); }
  catch (error) {
    if (error?.code === 'EPERM') { context.skip('Windows symlink privilege is unavailable'); return; }
    throw error;
  }
  const seeded = seedUser(userSub, [{ id: 4, confirmationPath: join(linkedDir, 'proof.png') }]);
  const handle = userStore.openUserDb(userSub);
  assert.ok(handle);
  handle.close();
  assert.deepEqual(readSources(seeded.userDb), [
    { posting_id: 4, application_source: 'unverified', application_task_id: null },
  ]);
});
