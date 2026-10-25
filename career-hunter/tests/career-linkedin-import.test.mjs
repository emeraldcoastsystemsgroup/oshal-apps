/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove bounded CSV parsing and actual owner-file imports through the compiled existing upload route, with lease release and no engine/profile/corpus effects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, readFile, writeFile, symlink, link, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCompiledModules } from './helpers/career-route-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parseLinkedInSavedJobs, canonicalLinkedInJob, importLinkedInSavedJobs, readLinkedInSavedJobs } = require('../routes/career-linkedin-import.js');
const candidates = [process.env.STORE_CI_TOOLCHAIN, resolve(root, '../scripts/toolchain/node_modules'),
  resolve(process.env.OSHAL_CORE_ROOT || resolve(root, '../../oshal/src'), 'node_modules')].filter(Boolean);
const toolchain = candidates.find(directory => ['express', 'multer'].every(name => existsSync(resolve(directory, name, 'package.json'))));
if (!toolchain) throw new Error('Express and Multer require scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const toolRequire = createRequire(resolve(toolchain, 'express/package.json'));
const express = toolRequire('express'), multer = toolRequire('multer');
const csv = (title = 'Platform Engineer', id = '123456789', company = 'Example Company') => Buffer.from(
  `Date Saved,Job Title,Company Name,Job Posting URL\r\n2026-10-24,"${title.replaceAll('"', '""')}","${company}",https://www.linkedin.com/jobs/view/${id}/?trackingId=private\r\n`);

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'career-linkedin-'));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}

test('actual exported-field headers, BOM, quoted commas and escaped quotes produce only canonical lead metadata', () => {
  const rows = parseLinkedInSavedJobs(Buffer.concat([Buffer.from('\uFEFF'), csv('Engineer, "Platform"')]));
  assert.deepEqual(rows, [{ id: '123456789', title: 'Engineer, "Platform"', company: 'Example Company',
    url: 'https://www.linkedin.com/jobs/view/123456789/', savedAt: '2026-10-24' }]);
  assert.deepEqual(canonicalLinkedInJob('https://linkedin.com/jobs/view/engineer-at-acme-123456789?trk=discarded'),
    { id: '123456789', url: 'https://www.linkedin.com/jobs/view/123456789/' });
  const aliases = parseLinkedInSavedJobs(Buffer.from(' POSITION TITLE , Employer , Job Url\nEngineer,Example,https://linkedin.com/jobs/view/42\n'));
  assert.equal(aliases[0].id, '42');
  assert.equal(aliases[0].savedAt, undefined);
  for (const header of ['LinkedIn Job Posting URL', 'LinkedIn Job URL']) {
    const prefixed = parseLinkedInSavedJobs(Buffer.from(`Job Title,Company Name,${header}\nEngineer,Example,https://linkedin.com/jobs/view/43\n`));
    assert.equal(prefixed[0].id, '43', header);
  }
});

test('malformed CSV and unsafe URLs fail closed without accepting a partial import', () => {
  for (const input of ['title,company,url\n"unterminated,Example,https://linkedin.com/jobs/view/42',
    'title,company,url\nEngineer,Example,https://linkedin.com/jobs/view/42,extra',
    'title,title,company,url\nEngineer,Other,Example,https://linkedin.com/jobs/view/42',
    'name,company,url\nEngineer,Example,https://linkedin.com/jobs/view/42',
    'title,company,url\n,Example,https://linkedin.com/jobs/view/42']) assert.throws(() => parseLinkedInSavedJobs(Buffer.from(input)), error => error.status === 400);
  for (const url of ['javascript:alert(1)', 'http://linkedin.com/jobs/view/42', 'https://linkedin.com.evil.invalid/jobs/view/42',
    'https://www.linkedin.com@evil.invalid/jobs/view/42', 'https://user:pass@linkedin.com/jobs/view/42',
    'https://linkedin.com:444/jobs/view/42', 'https://linkedin.com/jobs/view/%2e%2e/admin',
    'https://linkedin.com/jobs/view/42\\x', 'https://linkedin.com/jobs/search?jobId=42']) assert.throws(() => canonicalLinkedInJob(url), error => error.status === 400);
  assert.throws(() => parseLinkedInSavedJobs(Buffer.from([0xff, 0xfe])), error => error.status === 400);
});

test('byte, field, column and row ceilings are explicit input refusals', () => {
  assert.throws(() => parseLinkedInSavedJobs(Buffer.alloc(2 * 1024 * 1024 + 1)), error => error.status === 413);
  assert.throws(() => parseLinkedInSavedJobs(csv('x'.repeat(4097))), error => error.status === 413);
  assert.throws(() => parseLinkedInSavedJobs(Buffer.from(Array(33).fill('column').join(','))), error => error.status === 413);
  const rows = Array.from({ length: 501 }, (_, index) => `Role,Example,https://linkedin.com/jobs/view/${index + 1}`);
  assert.throws(() => parseLinkedInSavedJobs(Buffer.from('title,company,url\n' + rows.join('\n'))), error => error.status === 413);
});

test('actual owner files merge duplicates, avoid repeat rewrites and leave another owner empty', async t => {
  const directory = await scratch(t), alice = join(directory, 'alice'), bob = join(directory, 'bob');
  assert.deepEqual(await importLinkedInSavedJobs(alice, csv()), { ok: true, imported: 1, new: 1, updated: 0, total: 1 });
  const file = join(alice, 'linkedin-saved-jobs.json'), before = await readFile(file), beforeStat = await stat(file);
  assert.deepEqual(await importLinkedInSavedJobs(alice, csv()), { ok: true, imported: 1, new: 0, updated: 0, total: 1 });
  assert.deepEqual(await readFile(file), before); assert.equal((await stat(file)).mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(await importLinkedInSavedJobs(alice, csv('Engineering Manager')), { ok: true, imported: 1, new: 0, updated: 1, total: 1 });
  const jobs = await readLinkedInSavedJobs(alice);
  assert.equal(jobs[0].title, 'Engineering Manager');
  assert.equal(jobs[0].importedAt, JSON.parse(before).jobs[0].importedAt);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readLinkedInSavedJobs(bob), []);
  const duplicate = Buffer.from('title,company,url\nA,Example,https://linkedin.com/jobs/view/42\nB,Example,https://linkedin.com/jobs/view/42?trackingId=x');
  assert.equal(parseLinkedInSavedJobs(duplicate).length, 1);
  assert.equal(parseLinkedInSavedJobs(duplicate)[0].title, 'B');
  await assert.rejects(readFile(join(alice, 'career_db.json')), error => error.code === 'ENOENT');
});

test('corrupt, oversized, symlinked and hard-linked stored files are unavailable and never overwritten', async t => {
  const directory = await scratch(t), alice = join(directory, 'alice'), outside = join(directory, 'outside.json');
  await mkdir(alice); await writeFile(outside, '{"outside":true}');
  const file = join(alice, 'linkedin-saved-jobs.json');
  await symlink(outside, file);
  await assert.rejects(readLinkedInSavedJobs(alice)); await assert.rejects(importLinkedInSavedJobs(alice, csv()));
  assert.equal(await readFile(outside, 'utf8'), '{"outside":true}');
  await rm(file); await link(outside, file); await assert.rejects(readLinkedInSavedJobs(alice));
  await rm(file); await writeFile(file, '{broken'); await assert.rejects(importLinkedInSavedJobs(alice, csv()));
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1)); await assert.rejects(readLinkedInSavedJobs(alice));
  const alias = join(directory, 'alias'); await symlink(alice, alias); await assert.rejects(readLinkedInSavedJobs(alias));
});

test('the merged owner library enforces its total lead ceiling before any replacement', async t => {
  const directory = await scratch(t), alice = join(directory, 'alice');
  const rows = Array.from({ length: 500 }, (_, index) => `Role ${index},Example,https://linkedin.com/jobs/view/${index + 1}`);
  const result = await importLinkedInSavedJobs(alice, Buffer.from('title,company,url\n' + rows.join('\n')));
  assert.equal(result.total, 500);
  const file = join(alice, 'linkedin-saved-jobs.json'), before = await readFile(file);
  await assert.rejects(importLinkedInSavedJobs(alice, csv('New role', '999999')), error => error.status === 413);
  assert.deepEqual(await readFile(file), before);
});

test('existing compiled multipart route stores private leads, releases every lease and never dispatches an engine', async t => {
  const directory = await scratch(t), releases = [], claims = [];
  const { modules } = loadCompiledModules({ artifacts: 'routes/career-artifacts.js' }, {
    multer,
    './career-user-store': { callerSub: req => req.headers['x-fixture-sub'] || null, userPaths: sub => ({ userDir: join(directory, String(sub)) }) },
    './career-engine-dispatch': { runCareerCliAsync() { throw new Error('Saved jobs must never dispatch an engine'); } },
    './career-engine-runner': {
      tryAcquireRun() { throw new Error('Saved jobs do not need engine capacity'); },
      tryAcquireUploadRun(sub) { const lease = { status: 'ok', sub, kind: 'upload' }; claims.push(lease); return lease; },
      tryAcquireStorageRun(sub, slot) { const lease = { status: 'ok', sub, slot, kind: 'storage' }; claims.push(lease); return lease; },
      releaseRun(lease) { releases.push(lease); },
    },
  });
  const app = express(), router = express.Router(); modules.artifacts.registerCareerArtifacts(router, { pool: {} });
  app.use('/api/career-hunter', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/career-hunter`;
  async function upload(bytes, filename = 'Saved Jobs.csv', sub = 'alice') {
    const body = new FormData(); body.set('kind', 'linkedin-jobs'); body.append('files', new Blob([bytes]), filename);
    return fetch(base + '/artifacts/upload', { method: 'POST', body, headers: { 'x-fixture-sub': sub } });
  }
  const first = await upload(csv()); assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, imported: 1, new: 1, updated: 0, total: 1 });
  assert.equal((await upload(Buffer.from('not csv'), 'export.zip')).status, 400);
  assert.equal((await upload(csv('x'.repeat(4097)))).status, 413);
  const alice = await (await fetch(base + '/artifacts', { headers: { 'x-fixture-sub': 'alice' } })).json();
  const bob = await (await fetch(base + '/artifacts', { headers: { 'x-fixture-sub': 'bob' } })).json();
  assert.equal(alice.importedJobs.length, 1); assert.deepEqual(bob.importedJobs, []);
  assert.deepEqual(alice.uploaded, []); assert.deepEqual(alice.learned, []);
  assert.equal((await fetch(base + '/artifacts')).status, 401);
  await writeFile(join(directory, 'alice', 'linkedin-saved-jobs.json'), '{corrupt');
  const unavailable = await (await fetch(base + '/artifacts', { headers: { 'x-fixture-sub': 'alice' } })).json();
  assert.equal(unavailable.importedJobsUnavailable, true); assert.deepEqual(unavailable.importedJobs, []);
  assert.equal(claims.length, 6); assert.equal(releases.length, 6);
  assert.ok(claims.every(lease => releases.filter(item => item === lease).length === 1));
  assert.ok(claims.filter(lease => lease.kind === 'storage').every(lease => lease.slot === 'user-store'));
});

test('trusted buffered native requests need no stream events and retain the aggregate byte ceiling', async t => {
  const directory = await scratch(t), released = [], claims = [];
  delete require.cache[require.resolve('../routes/career-artifacts.js')];
  const { modules } = loadCompiledModules({ artifacts: 'routes/career-artifacts.js' }, {
    '@/shared/package-runs': Object.freeze({ native: true }),
    multer: () => ({ array: () => (req, _res, next) => {
      req.body = { kind: 'linkedin-jobs' }; req.files = [{ originalname: 'Saved Jobs.csv', buffer: csv() }]; next();
    } }),
    './career-user-store': { callerSub: () => 'alice', userPaths: () => ({ userDir: join(directory, 'alice') }) },
    './career-engine-dispatch': { runCareerCliAsync() { throw new Error('No native import engine dispatch'); } },
    './career-engine-runner': {
      tryAcquireRun() { throw new Error('No native import engine capacity'); },
      tryAcquireUploadRun() { const lease = { status: 'ok', kind: 'upload' }; claims.push(lease); return lease; },
      tryAcquireStorageRun() { const lease = { status: 'ok', kind: 'storage' }; claims.push(lease); return lease; },
      releaseRun(lease) { released.push(lease); },
    },
  });
  let handlers;
  modules.artifacts.registerCareerArtifacts({ get() {}, post(path, ...callbacks) {
    if (path === '/artifacts/upload') handlers = callbacks;
  } }, { pool: {} });
  async function call(bytes) {
    const req = { body: bytes };
    assert.equal(req.once, undefined); assert.equal(req.destroy, undefined);
    return new Promise((resolve, reject) => {
      let index = 0;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; resolve(this); return this; } };
      const next = error => {
        if (error) { reject(error); return; }
        try { Promise.resolve(handlers[index++](req, res, next)).catch(reject); }
        catch (error) { reject(error); }
      };
      next();
    });
  }
  const accepted = await call(Buffer.from('bounded native multipart body'));
  assert.equal(accepted.statusCode, 200); assert.equal(accepted.body.new, 1);
  const oversized = await call(Buffer.alloc(40 * 1024 * 1024 + 1));
  assert.equal(oversized.statusCode, 413);
  assert.equal(claims.length, 3); assert.equal(released.length, 3);
  assert.ok(claims.every(lease => released.filter(item => item === lease).length === 1));
});
