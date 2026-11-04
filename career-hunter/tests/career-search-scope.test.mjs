/**
 * CHANGE LOG
 * 41 | maintainer@emeraldcoastsystemsgroup.com | Include the source title/location columns used to recheck legacy workplace flags without changing geometry fixtures.
 * 40 | maintainer@emeraldcoastsystemsgroup.com | Support explicit search-to-board and document-to-status transitions, preserving manual submission provenance and owner-only state.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise private area persistence, exact remote-or-local SQL, and the Python scoring selector against disposable stores.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { readJobSearchScope, saveJobSearchScope, jobSearchScopeSql } = require('../routes/career-search-scope.js');
const { splitBoardFilters } = require('../routes/career-board-feed.js');
const scope = { version: 1, near: 'Destin, FL', lat: 30.4044, lon: -86.4714, radiusMiles: 70, includeRemote: true };

test('area preferences are private, bounded and fail closed when corrupted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-scope-'));
  try {
    const owner = join(root, 'owner');
    const saved = await saveJobSearchScope(owner, { near: 'Destin, FL', radiusMiles: 70, includeRemote: true });
    assert.deepEqual(saved, scope);
    assert.deepEqual(readJobSearchScope(owner), scope);
    assert.equal(statSync(join(owner, 'job-search-scope.json')).mode & 0o777, 0o600);
    assert.equal(readJobSearchScope(join(root, 'other-owner')), null);
    for (const radiusMiles of [0, 251, NaN, Infinity, '70']) {
      await assert.rejects(saveJobSearchScope(owner, { near: 'Destin, FL', radiusMiles, includeRemote: true }));
    }
    await assert.rejects(saveJobSearchScope(owner, { near: 'invalid', radiusMiles: 70, includeRemote: true }));
    assert.deepEqual(readJobSearchScope(owner), scope, 'invalid changes preserve the saved area');
    writeFileSync(join(owner, 'job-search-scope.json'), '{}');
    assert.throws(() => readJobSearchScope(owner));
    rmSync(join(owner, 'job-search-scope.json'));
    symlinkSync(join(root, 'missing'), join(owner, 'job-search-scope.json'));
    assert.throws(() => readJobSearchScope(owner), 'dangling links cannot silently widen scope');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual geographic SQL includes distant or unlocated remote jobs and only local on-site jobs', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE p(id INTEGER, remote INTEGER, city TEXT, lat REAL, lon REAL);
      INSERT INTO p VALUES (1,0,'destin',30.4044,-86.4714),(2,0,'pensacola',30.4213,-87.2169),
      (3,0,'los angeles',34.0522,-118.2437),(4,1,'los angeles',34.0522,-118.2437),
      (5,1,NULL,NULL,NULL),(6,0,NULL,NULL,NULL),(7,0,'bad',999,0),
      (8,0,'',30.4044,-86.4714),(9,0,'east outside circle',31.3,-85.6);`);
    db.exec('ALTER TABLE p ADD COLUMN title TEXT; ALTER TABLE p ADD COLUMN location TEXT;');
    const eligible = value => db.prepare(`SELECT id FROM p WHERE ${jobSearchScopeSql(value)} ORDER BY id`).all().map(r => r.id);
    assert.deepEqual(eligible(scope), [1, 2, 4, 5]);
    assert.deepEqual(eligible({ ...scope, includeRemote: false }), [1, 2]);
    assert.throws(() => jobSearchScopeSql({ ...scope, lat: NaN }));
    assert.throws(() => jobSearchScopeSql(scope, 'p); DROP TABLE p;--'));
  } finally { db.close(); }
});

test('hunt filters apply the saved scope without restricting explicit history tabs', () => {
  assert.match(splitBoardFilters({ lane: 'all', days: '7' }, scope).corpWhere, /p\.lat BETWEEN/);
  assert.doesNotMatch(splitBoardFilters({ status: 'generated' }, scope).corpWhere, /p\.lat BETWEEN/);
  for (const status of ['applied', 'interview', 'offer', 'dismissed']) {
    assert.doesNotMatch(splitBoardFilters({ status }, scope).corpWhere, /p\.lat BETWEEN/);
  }
});

test('TypeScript and Python share dateline, polar and radius boundary fixtures', () => {
  const cases = JSON.parse(readFileSync(new URL('./career-scope-geometry.json', import.meta.url), 'utf8'));
  for (const value of cases) {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE p(id INTEGER, remote INTEGER, city TEXT, lat REAL, lon REAL)');
      db.exec('ALTER TABLE p ADD COLUMN title TEXT; ALTER TABLE p ADD COLUMN location TEXT;');
      const insert = db.prepare("INSERT INTO p(id,remote,city,lat,lon) VALUES(?,0,'fixture',?,?)");
      value.points.forEach(([lat, lon], id) => insert.run(id,lat,lon));
      const rows = db.prepare(`SELECT id FROM p WHERE ${jobSearchScopeSql({ ...scope, lat: value.lat, lon: value.lon })} ORDER BY id`).all();
      assert.deepEqual(rows.map(row => row.id), value.eligible, value.name);
    } finally { db.close(); }
  }
});

test('Python scorer applies the same scope before spending a model call', () => {
  const result = spawnSync(process.env.CAREER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-search-scope-contract.py', import.meta.url))],
    { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /remote and local scoring passed/);
  const launcher = readFileSync(new URL('../bin/oshal-jobhunter.js', import.meta.url), 'utf8');
  assert.match(launcher, /remote_only=remote_only,recent_first=True/);
});
