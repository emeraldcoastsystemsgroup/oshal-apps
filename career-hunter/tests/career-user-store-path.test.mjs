/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard reversible OIDC path encoding, containment, case-fold collision resistance, and controller/CLI mapper parity.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reserve tenant-global corpus database and SQLite sidecar names from legacy user-directory mapping.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Reject unpaired surrogate identities without rejecting valid astral Unicode or replacement-character subjects.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Prove exact raw-directory compatibility preserves an existing legacy database across controller and CLI layout resolution.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Reject raw/canonical generation collisions, database collisions, Windows aliases, NUL identities, and unmarked encoded namespaces.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Reserve tenant metadata and prove failed publication never exposes an unmarked canonical directory.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Require a legacy ownership signature and reject symlink or case-variant database entries.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Reserve Windows device names regardless of case before legacy compatibility lookup.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Reject every unpaired-surrogate position and prioritize split-directory ambiguity over marker validation.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Prove read-only layout discovery preserves existing generations and never creates an absent store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapper = require('../lib/user-store-path.js');
const nodeFs = require('node:fs');

test('portable lowercase legacy identities retain their established store names', () => {
  for (const subject of ['user-42', 'alice@example.com', 'tenant_user.7']) {
    assert.equal(mapper.userStoreSegment(subject), subject);
    assert.equal(mapper.userSubFromStoreSegment(subject), subject);
  }
});

test('unsafe identities round-trip without traversal or case-fold collisions', () => {
  const subjects = ['../admin', '..\\admin', '/root', 'Alice', 'alice', 'CON', 'josé', 'a/b', 'a\\b'];
  const segments = subjects.map((subject) => mapper.userStoreSegment(subject));
  assert.equal(new Set(segments).size, subjects.length);
  for (const [index, segment] of segments.entries()) {
    if (subjects[index] === 'alice') assert.equal(segment, 'alice');
    else assert.match(segment, /^~sub-[a-z2-7]+$/);
    assert.equal(mapper.userSubFromStoreSegment(segment), subjects[index]);
    assert.doesNotMatch(segment, /[\\/]/);
  }
});

test('tenant-global corpus filenames can never become user directories', () => {
  for (const subject of ['corpus.db', 'corpus.db-wal', 'corpus.db-shm', 'corpus.db-journal']) {
    const segment = mapper.userStoreSegment(subject);
    assert.notEqual(segment, subject);
    assert.match(segment, /^~sub-/);
    assert.equal(mapper.userSubFromStoreSegment(segment), subject);
    assert.equal(mapper.userSubFromStoreSegment(subject), null);
  }
});

test('Windows device names never qualify for legacy compatibility regardless of case', () => {
  for (const subject of ['CON', 'Con.txt', 'lPt1', 'NUL']) {
    const segment = mapper.userStoreSegment(subject);
    assert.match(segment, /^~sub-/);
    assert.equal(mapper.userSubFromStoreSegment(segment), subject);
  }
});

test('malformed Unicode identities cannot collapse onto a replacement-character path', () => {
  for (const malformed of ['\uD800', '\uD801', 'prefix\uD800', '\uD800suffix', '\uDC00']) {
    assert.throws(() => mapper.userStoreSegment(malformed), /invalid Unicode/);
  }
  const subjects = ['\uFFFD', 'candidate-🙂'];
  for (const subject of subjects) {
    const segment = mapper.userStoreSegment(subject);
    assert.equal(mapper.userSubFromStoreSegment(segment), subject);
  }
  assert.throws(() => mapper.userStoreSegment('nul\0subject'), /NUL byte/);
});

test('malformed encoded names and overlong subjects fail closed', () => {
  assert.equal(mapper.userSubFromStoreSegment('~sub-not+base32'), null);
  assert.equal(mapper.userSubFromStoreSegment('~sub-a'), null);
  assert.throws(() => mapper.userStoreSegment('A'.repeat(300)), /too long/);
  assert.throws(() => mapper.userStoreSegment(''), /identity is required/);
});

test('contained resolution rejects root aliases, traversal, and absolute escape paths', () => {
  const root = join(packageRoot, 'fixture-root');
  assert.equal(mapper.resolveContainedPath(root, 'default', 'user-42'), join(root, 'default', 'user-42'));
  assert.throws(() => mapper.resolveContainedPath(root, '..', 'escape'), /escaped/);
  assert.throws(() => mapper.resolveContainedPath(root, root), /escaped/);
  assert.throws(() => mapper.resolveContainedPath(root), /escaped/);
});

test('an existing exact direct-child raw store remains a compatible legacy alias', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-migration-'));
  const tenantDir = join(root, 'default');
  const userSub = process.platform === 'win32' ? 'Auth0-user' : 'auth0|user';
  const legacyDir = join(tenantDir, userSub);
  const legacyDb = join(legacyDir, `user-${userSub}.db`);
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(legacyDb, 'legacy-user-data');
  try {
    assert.equal(mapper.legacyUserSubFromStoreEntry(tenantDir, userSub), userSub);
    const layout = mapper.resolveUserStoreLayout(root, 'default', userSub);
    assert.equal(existsSync(legacyDir), true);
    assert.equal(layout.userDir, legacyDir);
    assert.equal(readFileSync(layout.userDb, 'utf8'), 'legacy-user-data');
    assert.equal(mapper.resolveUserStoreLayout(root, 'default', userSub).userDb, layout.userDb);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only discovery finds existing stores without creating absent identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-readonly-'));
  try {
    assert.equal(mapper.findUserStoreLayout(root, 'default', 'absent-user'), null);
    assert.equal(existsSync(join(root, 'default')), false);
    const created = mapper.resolveUserStoreLayout(root, 'default', 'Existing-User');
    const found = mapper.findUserStoreLayout(root, 'default', 'Existing-User');
    assert.deepEqual(found, created);
    assert.equal(mapper.findUserStoreLayout(root, 'default', 'other-user'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy compatibility fails closed when raw and encoded directories both exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-dir-collision-'));
  const userSub = 'Legacy-User';
  const tenantDir = join(root, 'default');
  mkdirSync(join(tenantDir, userSub), { recursive: true });
  mkdirSync(join(tenantDir, mapper.userStoreSegment(userSub)), { recursive: true });
  try {
    assert.throws(
      () => mapper.resolveUserStoreLayout(root, 'default', userSub),
      /both legacy and canonical directories/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy compatibility fails closed when both database basenames exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-db-collision-'));
  const userSub = 'Legacy-Database';
  try {
    const layout = mapper.resolveUserStoreLayout(root, 'default', userSub);
    writeFileSync(join(layout.userDir, `user-${userSub}.db`), 'legacy');
    writeFileSync(join(layout.userDir, `user-${layout.userSegment}.db`), 'canonical');
    assert.throws(
      () => mapper.resolveUserStoreLayout(root, 'default', userSub),
      /both legacy and canonical databases/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('filesystem aliases and unmarked encoded namespaces are never adopted', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-alias-'));
  const tenantDir = join(root, 'default');
  mkdirSync(join(tenantDir, 'victim'), { recursive: true });
  try {
    const alias = mapper.resolveUserStoreLayout(root, 'default', 'victim.');
    assert.equal(existsSync(join(tenantDir, 'victim')), true);
    assert.notEqual(alias.userDir, join(tenantDir, 'victim'));
    const encoded = mapper.userStoreSegment('Unmarked-User');
    mkdirSync(join(tenantDir, encoded), { recursive: true });
    assert.throws(
      () => mapper.resolveUserStoreLayout(root, 'default', 'Unmarked-User'),
      /ambiguous without an identity marker/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tenant lock metadata can never be adopted as a legacy user directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-metadata-'));
  const lockRoot = join(root, 'default', '.career-run-locks');
  mkdirSync(lockRoot, { recursive: true });
  try {
    const layout = mapper.resolveUserStoreLayout(root, 'default', '.career-run-locks');
    assert.notEqual(layout.userDir, lockRoot);
    assert.equal(existsSync(lockRoot), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failed encoded-directory publish never exposes an unmarked canonical store', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-publish-'));
  const userSub = 'Publish-Failure';
  const encodedDir = join(root, 'default', mapper.userStoreSegment(userSub));
  const originalRename = nodeFs.renameSync;
  nodeFs.renameSync = () => { throw new Error('fixture publish interruption'); };
  try {
    assert.throws(
      () => mapper.resolveUserStoreLayout(root, 'default', userSub),
      /fixture publish interruption/,
    );
    assert.equal(existsSync(encodedDir), false);
  } finally {
    nodeFs.renameSync = originalRename;
  }
  try {
    const layout = mapper.resolveUserStoreLayout(root, 'default', userSub);
    assert.equal(layout.userDir, encodedDir);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unsigned raw directory is never adopted as an existing user store', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-unsigned-'));
  const userSub = 'Unsigned-User';
  const rawDir = join(root, 'default', userSub);
  mkdirSync(rawDir, { recursive: true });
  try {
    const layout = mapper.resolveUserStoreLayout(root, 'default', userSub);
    assert.notEqual(layout.userDir, rawDir);
    assert.equal(existsSync(rawDir), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('case-variant database entries fail closed on every filesystem', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-db-case-'));
  try {
    const layout = mapper.resolveUserStoreLayout(root, 'default', 'case-user');
    writeFileSync(join(layout.userDir, 'USER-CASE-USER.DB'), 'alias');
    assert.throws(
      () => mapper.resolveUserStoreLayout(root, 'default', 'case-user'),
      /symlink or case alias/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a canonical database symlink is rejected instead of followed', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'career-store-db-symlink-'));
  const outside = join(root, 'outside.db');
  writeFileSync(outside, 'outside');
  try {
    const layout = mapper.resolveUserStoreLayout(root, 'default', 'symlink-user');
    try { symlinkSync(outside, layout.userDb, 'file'); }
    catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') { context.skip('symlink privilege unavailable'); return; }
      throw error;
    }
    assert.throws(
      () => mapper.resolveUserStoreLayout(root, 'default', 'symlink-user'),
      /symlink or case alias/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the API leaf and CLI both consume the one shared path and migration mapper', () => {
  const api = readFileSync(join(packageRoot, 'src-routes', 'career-user-store.ts'), 'utf8');
  const cli = readFileSync(join(packageRoot, 'bin', 'oshal-jobhunter.js'), 'utf8');
  assert.match(api, /require\(['"]\.\.\/lib\/user-store-path['"]\)/);
  assert.match(cli, /require\(['"]\.\.\/lib\/user-store-path['"]\)/);
  assert.match(api, /resolveUserStoreLayout/);
  assert.match(cli, /resolveUserStoreLayout/);
  assert.match(api, /resolveContainedPath/);
  assert.match(cli, /resolveContainedPath/);
});
