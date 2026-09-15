/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove actual core AsyncLocalStorage survives real memory/disk multipart middleware, preserves exact nonoperator identity and fails closed for absent or mismatched authority.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the framework checkout from OSHAL_CORE_ROOT first (what the Test Lab sandbox sets, /app) and OSHAL_CORE_DIR second, and fail loud when neither is set. The old default C:/Projects/oshal existed on one Windows box only and turned a missing variable into a confusing module error.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { startFixture, json, photo, coreRequire } = require('./routes-core.fixture.js');
coreRequire('tsx/cjs');
const identityModule = coreRequire(path.join(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR, 'src/shared/services/database/request-identity.ts'));
let f, id;
test.beforeEach(async () => {
  f = await startFixture({ identityModule });
  const made = await f.call('/jobs', json('POST', { title: 'Synthetic identity check' }));
  assert.equal(made.status, 201); id = made.body.job.job_id; f.control.identityQueries.length = 0;
});
test.afterEach(async () => { await f.close(); });

function exactIdentity() {
  assert.ok(f.control.identityQueries.length >= 2, 'both admission lookups must execute');
  for (const entry of f.control.identityQueries) assert.deepEqual(entry.identity,
    { sub: 'alice', principalIssuer: 'https://scan-fixture.invalid', isOperator: false }, entry.operation);
}

function uploadDirectory() {
  const owner = createHash('sha256').update('alice').digest('hex').slice(0, 16);
  const dir = path.join(f.tmp, owner, id, 'uploads');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function cloudBytes() {
  const points = [];
  for (let x = 0; x <= 12; x += 1) for (let y = 0; y <= 10; y += 1) points.push([x, y, 0], [x, y, 8]);
  for (let x = 0; x <= 12; x += 1) for (let z = 0; z <= 8; z += 1) points.push([x, 0, z], [x, 10, z]);
  for (let y = 0; y <= 10; y += 1) for (let z = 0; z <= 8; z += 1) points.push([0, y, z], [12, y, z]);
  return `ply\nformat ascii 1.0\nelement vertex ${points.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${points.map(p => p.join(' ')).join('\n')}\n`;
}

async function diskUpload(lane, bytes) {
  const body = new FormData();
  body.append(lane === 'video' ? 'video' : 'model', new Blob([bytes]), lane === 'video' ? 'synthetic.mp4' : 'synthetic.ply');
  if (lane === 'pointcloud') { body.append('voxelMm', '2'); body.append('unitScale', '1'); body.append('up', 'z'); }
  return f.call(`/jobs/${id}/${lane}`, { method: 'POST', body });
}

test('memory photo upload retains exact core identity at both admission lookups and every write', async () => {
  const result = await f.uploadPhotos(id, [['synthetic.png', await photo(20, 10)]]);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.images.length, 1);
  exactIdentity();
  assert.ok(f.control.identityQueries.some(q => q.operation === 'INSERT'));
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.execCalls.length, 0);
});

test('disk PLY upload retains exact core identity through reconstruction and cleans its temporary file', async () => {
  const result = await diskUpload('pointcloud', cloudBytes());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.report.lane, 'pointcloud');
  exactIdentity(); assert.deepEqual(uploadDirectory(), []);
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.execCalls.length, 0);
});

test('disk video upload retains exact core identity through frame ingestion and cleans its temporary file', async () => {
  const frame = await photo(20, 10);
  f.control.execFile = async (_file, args) => {
    fs.writeFileSync(args.at(-1).replace('%03d', '001'), frame);
    return { stdout: '', stderr: '' };
  };
  const result = await diskUpload('video', 'synthetic media handled only by the explicit process double');
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.frames, 1);
  exactIdentity(); assert.deepEqual(uploadDirectory(), []);
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.execCalls.length, 1);
});

test('unauthenticated and other-owner multipart requests remain refused before mutation', async () => {
  const frame = await photo(20, 10);
  f.control.sub = null;
  assert.equal((await f.uploadPhotos(id, [['synthetic.png', frame]])).status, 401);
  f.control.sub = 'bob';
  assert.equal((await f.uploadPhotos(id, [['synthetic.png', frame]])).status, 404);
  assert.equal(f.pool.tables.scan_print_image.length, 0);
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.execCalls.length, 0);
  assert.ok(f.control.identityQueries.every(q => q.identity.sub === 'bob' && q.identity.isOperator === false));
});

test('a mismatched ambient identity is never reconstructed from the request subject or upgraded', async () => {
  const wrong = { sub: 'other-actor', principalIssuer: 'https://other-fixture.invalid', isOperator: false };
  f.control.ambientIdentity = wrong;
  assert.equal((await f.uploadPhotos(id, [['synthetic.png', await photo(20, 10)]])).status, 404);
  assert.ok(f.control.identityQueries.length > 0);
  assert.ok(f.control.identityQueries.every(q => JSON.stringify(q.identity) === JSON.stringify(wrong)));
  assert.equal(f.pool.tables.scan_print_image.length, 0);
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.execCalls.length, 0);
});
