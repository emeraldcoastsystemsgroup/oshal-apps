/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A reconstruction at the default resolution (96 voxels across) of a round object fits one native save. The fixture reproduces the live failure first: written as before (STL + plain OBJ + drawing + report + contours) the outputs encode past the kernel's 16 MiB transaction bound, which rolled the request back as "application_route_failed". Through the shipped plan the save stays inside it, the stored OBJ inflates to the exact OBJ text, an OBJ too large for one download is left out with a warning, and a mesh whose STL cannot be downloaded is refused with a resolution that then fits.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));
const budget = require(path.resolve(__dirname, '..', 'routes', 'artifact-budget.js'));

/** The kernel's commit bound (crates/control/src/data_snapshot.rs MAX_TRANSACTION_BYTES). */
const TRANSACTION_BYTES = 16 * 1024 * 1024;
/** The bridge stores files in 192 KiB chunks, each a JSON document holding the chunk as base64. */
const CHUNK = 192 * 1024;
/** Encoded bytes a set of new files adds to one commit (base64 bodies plus a generous per-document envelope). */
const encoded = (sizes) => sizes.reduce((sum, n) => sum + Math.ceil(n / 3) * 4 + Math.ceil(n / CHUNK) * 256, 0);

const disc = (r) => e.maskFromPredicate(400, 400, (x, y) => (x - 200) ** 2 + (y - 200) ** 2 < r * r);
/** A sphere-like object from three round silhouettes, reconstructed at `resolution`. */
function sphere(resolution) {
  const views = ['front', 'top', 'right'].map((view) => ({ view, mask: disc(150) }));
  const result = e.reconstructFromSilhouettes(views, [{ axis: 'x', mm: 60 }], { resolution, partName: 'ball' });
  return { result, artifacts: e.exportArtifacts(result, 'STP-TEST') };
}
const small = (a) => [['svg', Buffer.from(a.svg)], ['contours', Buffer.from('{}')]];
const stlOf = (a) => Buffer.from(a.stl.buffer, a.stl.byteOffset, a.stl.byteLength);

test('the default resolution is 96 and, written as before, a round object overflows one save', () => {
  assert.equal(e.RECONSTRUCTION_LIMITS.resolution.default, 96);
  const { artifacts } = sphere(96);
  const before = [artifacts.stl.byteLength, Buffer.byteLength(artifacts.obj), Buffer.byteLength(artifacts.svg), Buffer.byteLength(JSON.stringify(artifacts.report, null, 2))];
  assert.ok(encoded(before) > TRANSACTION_BYTES, `the fixture reproduces the overflow (${encoded(before)} encoded bytes)`);
});

test('through the plan a 96-voxel reconstruction fits one save and the OBJ comes back exact', () => {
  const zlib = require('node:zlib');
  const { artifacts } = sphere(96);
  const plan = budget.planArtifacts(stlOf(artifacts), artifacts.obj, small(artifacts), artifacts.report);
  assert.deepEqual(plan.warnings, []);
  const sizes = plan.files.map(([, bytes]) => bytes.length).concat([Buffer.byteLength(JSON.stringify(artifacts.report, null, 2))]);
  assert.ok(encoded(sizes) < TRANSACTION_BYTES - 1024 * 1024, `fits with room for the SQL rows (${encoded(sizes)} encoded bytes)`);
  const obj = plan.files.find(([key]) => key === 'obj')[1];
  assert.equal(obj[0], 0x1f, 'the OBJ is stored compressed');
  assert.equal(budget.downloadBytes('obj', obj).toString('utf8'), artifacts.obj, 'the download inflates it to the exact OBJ');
  assert.ok(Buffer.byteLength(artifacts.obj) <= budget.DOWNLOAD_LIMIT_BYTES, 'and it fits one download');
  const stl = stlOf(artifacts);
  assert.equal(budget.downloadBytes('stl', stl), stl, 'other artifacts download as written');
  assert.equal(zlib.gunzipSync(obj).length, Buffer.byteLength(artifacts.obj));
});

test('an OBJ too large for one download is left out and the report says why', () => {
  const { artifacts } = sphere(128);
  const plan = budget.planArtifacts(stlOf(artifacts), artifacts.obj, small(artifacts), artifacts.report);
  assert.deepEqual(plan.files.map(([key]) => key), ['stl', 'svg', 'contours']);
  assert.match(plan.warnings[0], /^The OBJ \(\d+\.\d MB\) is larger than one download can carry here, so only the STL was kept; reconstruct at resolution \d+ or lower/);
});

test('a mesh whose STL cannot be downloaded is refused with a resolution that then fits', () => {
  const { artifacts } = sphere(160);
  let refusal = null;
  try { budget.planArtifacts(stlOf(artifacts), artifacts.obj, small(artifacts), artifacts.report); } catch (err) { refusal = err; }
  assert.ok(refusal instanceof RangeError, 'a RangeError, which every reconstruct route answers as 422 with its message');
  const suggested = Number(/Reconstruct at resolution (\d+) or lower/.exec(refusal.message)[1]);
  assert.match(refusal.message, /more than one download can carry here/);
  const retry = sphere(suggested).artifacts;
  assert.doesNotThrow(() => budget.planArtifacts(stlOf(retry), retry.obj, small(retry), retry.report));
});
