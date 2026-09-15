/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The depth lane over loopback HTTP (BACKLOG B1/B8): three photos of a solid cylinder reconstruct to the hull, then a top range image of a cup, uploaded as float32 and again as a real 16-bit PNG, refines THAT hull so the cavity is recovered within 5 % of pi 14^2 45 mm3, the report lane reads depth and lists the silhouette and the depth views, and source_kind stays photos (the migration's CHECK allows nothing else); refusals are 4xx with reasons (no views, no file, a missing header field, an 8-bit PNG, a sensor plane inside the part) and another owner gets 404.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/depth.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startFixture, json, photo, coreRequire } = require('./routes-core.fixture.js');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));
const sharp = coreRequire('sharp');
let fixture;
test.before(async () => { fixture = await startFixture(); });
test.after(async () => fixture.close());
const call = (...args) => fixture.call(...args);

/** A top-view photo of a disc of radius `rMm` at the fixture's 2 px/mm. */
async function disc(rMm) {
  const w = 200, h = 200, data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    data.set(Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) < 2 * rMm ? [40, 70, 160] : [214, 200, 176], (y * w + x) * 3);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** A job holding three photos of a solid cylinder r=20 h=50, views assigned and the height entered. */
async function cylinderJob(title) {
  const created = await call('/jobs', json('POST', { title }));
  const id = created.body.job.job_id;
  const up = await fixture.uploadPhotos(id, [['front.png', await photo(40, 50)], ['right.png', await photo(40, 50)], ['top.png', await disc(20)]]);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (const [i, view] of ['front', 'right', 'top'].entries()) {
    assert.equal((await call(`/jobs/${id}/images/${up.body.images[i].image_id}`, json('PATCH', { view }))).status, 200);
  }
  assert.equal((await call(`/jobs/${id}`, json('PATCH', { knownDimensions: [{ axis: 'z', mm: 50 }] }))).status, 200);
  return id;
}

/** A top range image of an analytic cup (r 20, cavity r 14, floor 5 mm), rendered on its own fine grid like a sensor would see it. */
function cupRangeImage() {
  const g = e.createOccupancyGrid({ x: 40, y: 40, z: 50 }, 0.5, 1, 0);
  for (let k = 0; k < g.nz; k += 1) for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
    const p = e.voxelCenter(g, i, j, k);
    const r = Math.hypot(p.x, p.y);
    if (r < 20 && p.z > 0 && p.z < 50 && !(r < 14 && p.z > 5)) g.data[e.gridIndex(g, i, j, k)] = 1;
  }
  return e.renderDepth(g, 'top', { mmPerPx: 0.5, width: 120, height: 120 });
}

/** POST a range image with its placement header. */
async function postDepth(id, bytes, format, map, extra = {}) {
  const form = new FormData();
  form.append('depth', new Blob([bytes]), format === 'png16' ? 'depth.png' : 'depth.f32');
  const fields = { format, view: map.view, width: map.width, height: map.height, mmPerPx: map.mmPerPx, uCenterPx: map.uCenterPx, vCenterPx: map.vCenterPx,
    uCenterMm: map.uCenterMm, vCenterMm: map.vCenterMm, planeMm: map.planeMm, resolution: 64, smoothIterations: 0, ...extra };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, String(value));
  return call(`/jobs/${id}/depth`, { method: 'POST', body: form });
}

const f32 = (map) => { const b = Buffer.alloc(map.data.length * 4); map.data.forEach((d, i) => b.writeFloatLE(d, i * 4)); return b; };
const CAVITY = Math.PI * 14 * 14 * 45;

test('B1/B8: a top range image refines the photo hull over HTTP and recovers the cup cavity', async () => {
  const id = await cylinderJob('cup');
  const hull = await call(`/jobs/${id}/reconstruct`, json('POST', { resolution: 64, smoothIterations: 0 }));
  assert.equal(hull.status, 200, JSON.stringify(hull.body));
  assert.equal(hull.body.report.lane, 'silhouettes');
  const map = cupRangeImage();
  const out = await postDepth(id, f32(map), 'f32le', map);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const { report } = out.body;
  assert.equal(report.lane, 'depth');
  assert.deepEqual(report.viewsUsed, ['front', 'right', 'top']);
  assert.deepEqual(report.depthViews, ['top']);
  assert.match(report.method, /Visual hull from 3 silhouettes .*depth-carved from 1 range image \(top\)/);
  const cavity = hull.body.report.gridVolumeMm3 - report.gridVolumeMm3;
  assert.ok(Math.abs(cavity - CAVITY) / CAVITY < 0.05, `cavity ${cavity.toFixed(0)} mm3 against ${CAVITY.toFixed(0)}`);
  assert.equal(report.validation.valid, true);
  assert.equal(out.body.job.source_kind, 'photos', 'the hull source stays the job source; the CHECK constraint allows no other value');
  assert.equal(out.body.job.state, 'reconstructed');
  const detail = await call(`/jobs/${id}`);
  assert.equal(detail.body.artifacts.stl, true, 'the refined model is the current download');

  const scale = 0.01;
  const samples = Uint16Array.from(map.data, (d) => (Number.isFinite(d) ? Math.round(d / scale) : 0));
  const png = await sharp(samples, { raw: { width: map.width, height: map.height, channels: 1 } }).toColourspace('grey16').png().toBuffer();
  assert.equal((await sharp(png).metadata()).depth, 'ushort', 'the upload is a real 16-bit PNG');
  const viaPng = await postDepth(id, png, 'png16', map, { width: undefined, height: undefined, depthScale: scale });
  assert.equal(viaPng.status, 200, JSON.stringify(viaPng.body));
  assert.equal(viaPng.body.report.gridVolumeMm3, report.gridVolumeMm3, 'the 16-bit PNG carves exactly what the float32 image carved');
});

test('B1: refusals are 4xx with reasons, and another owner cannot reach the job', async () => {
  const map = cupRangeImage();
  const empty = (await call('/jobs', json('POST', { title: 'no photos' }))).body.job.job_id;
  const noViews = await postDepth(empty, f32(map), 'f32le', map);
  assert.equal(noViews.status, 409);
  assert.equal(noViews.body.error, 'no_views_assigned');

  const id = await cylinderJob('refusals');
  const noFile = await call(`/jobs/${id}/depth`, { method: 'POST', body: new FormData() });
  assert.equal(noFile.status, 400);
  assert.equal(noFile.body.error, 'no_depth');
  const noPlane = await postDepth(id, f32(map), 'f32le', map, { planeMm: undefined });
  assert.equal(noPlane.status, 422);
  assert.match(noPlane.body.message, /planeMm is required/);
  const eightBit = await sharp(Buffer.alloc(map.width * map.height, 9), { raw: { width: map.width, height: map.height, channels: 1 } }).png().toBuffer();
  const refused8 = await postDepth(id, eightBit, 'png16', map, { width: undefined, height: undefined });
  assert.equal(refused8.status, 422);
  assert.match(refused8.body.message, /16-bit samples/);
  const inside = await postDepth(id, f32(map), 'f32le', map, { planeMm: -25 });
  assert.equal(inside.status, 422);
  assert.equal(inside.body.error, 'depth_refused');
  assert.match(inside.body.message, /lies inside the part/);
  assert.equal((await call(`/jobs/${id}`)).body.job.state, 'failed', 'a refused build leaves no stale output behind');

  fixture.control.sub = 'mallory';
  try {
    assert.equal((await postDepth(id, f32(map), 'f32le', map)).status, 404);
  } finally { fixture.control.sub = 'alice'; }
});

test('B1: /capabilities lists the depth lane and its bounds', async () => {
  const caps = await call('/capabilities');
  assert.ok(caps.body.lanes.includes('depth'));
  assert.deepEqual(caps.body.depth.formats, ['png16', 'f32le']);
  assert.equal(caps.body.upload.depthBytes, caps.body.depth.maxPixels * 4);
});
