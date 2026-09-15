/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | The contours artifact serves as JSON with the three outlines and the extents through the retained isolated fixture.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Reuse the isolated HTTP fixture without changing the seven original route assertions.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The camera module is served beside the viewer from the fixed asset list.
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The packaged routes over real loopback HTTP with express, multer and sharp resolved from the framework checkout (OSHAL_CORE_DIR): the surface and assets serve, the caller gate 401s, jobs are owner-scoped (a second subject gets 404), three synthetic photos upload → silhouettes → views → ruler → reconstruct → STL/OBJ/SVG/report download with byte-identical re-runs, refusals are 4xx with reasons, printers store only ciphertext and never echo a key, printing needs confirm:true (428), G-code needs a slicer (409) unless one is configured (fake execFile), STL goes to an OctoPrint double and never to Moonraker, a point-cloud upload closes and fills, and deleting a job removes its files. The database is a SQL-dispatching in-memory double — the owner RLS boundary itself is proven by the migration's policy text and the live installer, not here.
 * 5   | maintainer@emeraldcoastsystemsgroup.com     | The point-cloud route's base seal (BACKLOG B7) over the same loopback fixture: the same no-underside capture leaks with the flag off and closes to 72000 mm3 with it on, the response and the report both record the seal and the report carries the assumption warning, and an unreadable flag value is refused 422 rather than quietly read as off.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture, json, photo } = require('./routes-core.fixture.js');
let fixture, pool, env, tmp, base, fetchCalls;
test.before(async () => {
  fixture = await startFixture();
  ({ pool, env, tmp, base, fetchCalls } = fixture);
});
test.after(async () => fixture.close());
const call = (...args) => fixture.call(...args);
const uploadPhotos = (...args) => fixture.uploadPhotos(...args);

test('surface, assets and capabilities serve; the caller gate answers 401', async () => {
  const page = await call('/app');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('<title>Scan to Print</title>'));
  const js = await call('/assets/scan-to-print-gl.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const camera = await call('/assets/scan-to-print-camera.js');
  assert.equal(camera.status, 200);
  assert.ok(camera.text.includes('ScanToPrintCamera'), 'the camera module serves from the fixed asset list');
  assert.ok(page.text.includes('/assets/scan-to-print-camera.js'), 'the surface loads it');
  const caps = await call('/capabilities');
  assert.deepEqual(caps.body.views, ['front', 'back', 'left', 'right', 'top', 'bottom']);
  assert.equal(caps.body.limits.resolution.default, 96);
  assert.equal(caps.body.printers.slicerConfigured, false);
  fixture.control.sub = null;
  assert.equal((await call('/jobs')).status, 401);
  assert.equal((await call('/printers')).status, 401);
  fixture.control.sub = 'alice';
});

let jobId;
test('jobs are created, listed and owner-scoped', async () => {
  const created = await call('/jobs', json('POST', { title: 'test box' }));
  assert.equal(created.status, 201);
  jobId = created.body.job.job_id;
  assert.equal((await call('/jobs')).body.jobs.length, 1);
  assert.equal((await call('/jobs', json('POST', { title: '   ' }))).status, 400);
  fixture.control.sub = 'mallory';
  assert.equal((await call(`/jobs/${jobId}`)).status, 404);
  assert.equal((await call('/jobs')).body.jobs.length, 0);
  fixture.control.sub = 'alice';
  assert.equal((await call('/jobs/not-a-uuid')).status, 400);
});

let stlBytes;
test('photos → silhouettes → views → ruler → reconstruct → artifacts, byte-identical on re-run', async () => {
  const up = await uploadPhotos(jobId, [['front.png', await photo(60, 30)], ['top.png', await photo(60, 40)], ['right.png', await photo(40, 30)]]);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.images.length, 3);
  assert.ok(up.body.images[0].silhouette.stats.pixels > 0);
  const noViews = await call(`/jobs/${jobId}/reconstruct`, json('POST', {}));
  assert.equal(noViews.status, 409);
  for (const [i, view] of ['front', 'top', 'right'].entries()) {
    const r = await call(`/jobs/${jobId}/images/${up.body.images[i].image_id}`, json('PATCH', { view }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal((await call(`/jobs/${jobId}/images/${up.body.images[0].image_id}`, json('PATCH', { view: 'sideways' }))).status, 400);
  assert.equal((await call(`/jobs/${jobId}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: -5 }] }))).status, 400);
  assert.equal((await call(`/jobs/${jobId}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: 60 }] }))).status, 200);
  const rec = await call(`/jobs/${jobId}/reconstruct`, json('POST', { resolution: 48, smoothIterations: 0 }));
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  const { report } = rec.body;
  assert.equal(report.dimensionSources.x, 'known');
  assert.ok(Math.abs(report.sizeMm.y - 40) <= report.voxelMm && Math.abs(report.sizeMm.z - 30) <= report.voxelMm, JSON.stringify(report.sizeMm));
  assert.equal(report.printable, true);
  const detail = await call(`/jobs/${jobId}`);
  assert.equal(detail.body.job.state, 'reconstructed');
  assert.deepEqual(detail.body.artifacts, { stl: true, obj: true, svg: true, report: true, gcode: false, contours: true });
  const stl = await fetch(`${base}/jobs/${jobId}/artifacts/stl?download`);
  assert.equal(stl.status, 200);
  assert.match(stl.headers.get('content-disposition'), /test_box\.stl/);
  stlBytes = Buffer.from(await stl.arrayBuffer());
  assert.equal(stlBytes.length, 84 + 50 * report.triangleCount);
  const contours = await call(`/jobs/${jobId}/artifacts/contours`);
  assert.equal(contours.status, 200);
  assert.match(contours.headers.get('content-type'), /json/);
  assert.deepEqual(Object.keys(contours.body.views).sort(), ['front', 'right', 'top']);
  assert.ok(contours.body.pointCounts.front >= 4 && contours.body.voxelMm > 0 && contours.body.sizeMm.x > 0);
  const svg = await call(`/jobs/${jobId}/artifacts/svg`);
  assert.match(svg.headers.get('content-type'), /svg/);
  assert.ok(svg.text.includes('THIRD ANGLE'));
  assert.equal((await call(`/jobs/${jobId}/artifacts/bogus`)).status, 400);
  const again = await call(`/jobs/${jobId}/reconstruct`, json('POST', { resolution: 48, smoothIterations: 0 }));
  assert.equal(again.status, 200);
  const stl2 = Buffer.from(await (await fetch(`${base}/jobs/${jobId}/artifacts/stl`)).arrayBuffer());
  assert.equal(Buffer.compare(stlBytes, stl2), 0, 'same inputs, same bytes');
  const mask = await fetch(`${base}/jobs/${jobId}/images/${up.body.images[0].image_id}/file?kind=mask`);
  assert.equal(mask.headers.get('content-type'), 'image/png');
});

let printerId;
test('printers store ciphertext only and never echo the key; status probes the host', async () => {
  const bad = await call('/printers', json('POST', { label: 'p', kind: 'octoprint', baseUrl: 'http://localhost:5000', apiKey: 'K' }));
  assert.equal(bad.status, 400);
  const made = await call('/printers', json('POST', { label: 'Bench', kind: 'octoprint', baseUrl: 'http://octopi.local/', apiKey: 'SECRET-KEY' }));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  printerId = made.body.printer.printer_id;
  assert.ok(!JSON.stringify(made.body).includes('SECRET-KEY'));
  const stored = pool.tables.scan_print_printer[0];
  assert.ok(stored.api_key_ciphertext.startsWith('enc:v1:') && !stored.api_key_ciphertext.includes('SECRET-KEY'));
  const listed = await call('/printers');
  assert.equal(listed.body.printers.length, 1);
  assert.ok(!('api_key_ciphertext' in listed.body.printers[0]));
  fixture.control.printerAnswer = { status: 200, body: { state: 'Operational' } };
  const status = await call(`/printers/${printerId}/status`, { method: 'POST' });
  assert.equal(status.status, 200);
  assert.equal(status.body.status.state, 'operational');
  assert.equal(fetchCalls.at(-1).init.headers['X-Api-Key'], 'SECRET-KEY');
  fixture.control.sub = 'mallory';
  assert.equal((await call(`/printers/${printerId}/status`, { method: 'POST' })).status, 404);
  fixture.control.sub = 'alice';
});

test('printing needs confirm, G-code needs a slicer, STL goes only where a host accepts it', async () => {
  const unconfirmed = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'stl' }));
  assert.equal(unconfirmed.status, 428);
  assert.equal(unconfirmed.body.error, 'confirmation_required');
  const noSlicer = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'gcode', confirm: true }));
  assert.equal(noSlicer.status, 409);
  assert.equal(noSlicer.body.error, 'needs_gcode');
  fixture.control.printerAnswer = { status: 201, body: { done: true } };
  const stl = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'stl', startPrint: true, confirm: true }));
  assert.equal(stl.status, 201, JSON.stringify(stl.body));
  assert.equal(stl.body.submission.state, 'uploaded', 'an STL is never auto-started');
  assert.equal(fetchCalls.at(-1).url, 'http://octopi.local/api/files/local');
  const moon = await call('/printers', json('POST', { label: 'K1', kind: 'moonraker', baseUrl: 'http://klipper.lan', apiKey: 'MK' }));
  const stlToMoon = await call(`/jobs/${jobId}/print`, json('POST', { printerId: moon.body.printer.printer_id, fileKind: 'stl', confirm: true }));
  assert.equal(stlToMoon.status, 409);
  assert.equal(stlToMoon.body.error, 'unsupported_file');
  env.SCAN_TO_PRINT_SLICER_CMD = 'fake-slicer --export {input} {output}';
  fixture.control.printerAnswer = { status: 201, body: { item: {}, print_started: true } };
  const gcode = await call(`/jobs/${jobId}/print`, json('POST', { printerId: moon.body.printer.printer_id, fileKind: 'gcode', startPrint: true, confirm: true }));
  assert.equal(gcode.status, 201, JSON.stringify(gcode.body));
  assert.equal(gcode.body.submission.state, 'printing');
  assert.equal(fetchCalls.at(-1).url, 'http://klipper.lan/server/files/upload');
  const subs = await call(`/jobs/${jobId}/submissions`);
  assert.equal(subs.body.submissions.length, 2);
  fixture.control.printerAnswer = { status: 500, body: { error: 'boom' } };
  const failed = await call(`/jobs/${jobId}/print`, json('POST', { printerId, fileKind: 'stl', confirm: true }));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.submission.state, 'failed');
});

test('a point cloud upload closes, fills and reconstructs through the same tail', async () => {
  const pts = [];
  for (let a = 0; a <= 60; a += 1) for (let b = 0; b <= 40; b += 1) { pts.push([a - 30, b - 20, 0], [a - 30, b - 20, 30]); }
  for (let a = 0; a <= 60; a += 1) for (let c = 0; c <= 30; c += 1) { pts.push([a - 30, -20, c], [a - 30, 20, c]); }
  for (let b = 0; b <= 40; b += 1) for (let c = 0; c <= 30; c += 1) { pts.push([-30, b - 20, c], [30, b - 20, c]); }
  const ply = `ply\nformat ascii 1.0\nelement vertex ${pts.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${pts.map((p) => p.join(' ')).join('\n')}\n`;
  const created = await call('/jobs', json('POST', { title: 'lidar box' }));
  const form = new FormData();
  form.append('model', new Blob([ply]), 'box.ply');
  form.append('voxelMm', '2'); form.append('unitScale', '1'); form.append('up', 'z');
  const out = await call(`/jobs/${created.body.job.job_id}/pointcloud`, { method: 'POST', body: form });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.closed, true);
  assert.equal(out.body.report.lane, 'pointcloud');
  assert.equal(out.body.report.gridVolumeMm3, 72000);
  assert.equal(out.body.job.source_kind, 'pointcloud');
});

test('B7: the point cloud route seals the base on request and refuses an unreadable flag', async () => {
  const pts = [];
  for (let a = 0; a <= 60; a += 1) for (let b = 0; b <= 40; b += 1) pts.push([a - 30, b - 20, 30]);
  for (let a = 0; a <= 60; a += 1) for (let c = 1; c <= 30; c += 1) { pts.push([a - 30, -20, c], [a - 30, 20, c]); }
  for (let b = 0; b <= 40; b += 1) for (let c = 1; c <= 30; c += 1) { pts.push([-30, b - 20, c], [30, b - 20, c]); }
  const ply = `ply\nformat ascii 1.0\nelement vertex ${pts.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${pts.map((p) => p.join(' ')).join('\n')}\n`;
  const post = async (fields) => {
    const created = await call('/jobs', json('POST', { title: 'lidar box with no underside' }));
    const form = new FormData();
    form.append('model', new Blob([ply]), 'box.ply');
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return call(`/jobs/${created.body.job.job_id}/pointcloud`, { method: 'POST', body: form });
  };
  const leaked = await post({ voxelMm: '2', unitScale: '1', up: 'z' });
  assert.equal(leaked.status, 200, JSON.stringify(leaked.body));
  assert.equal(leaked.body.closed, false, 'an unscanned underside must leak when the flag is off');
  assert.equal(leaked.body.sealedBase, false);
  assert.equal(leaked.body.report.sealedBase, false);
  const sealed = await post({ voxelMm: '2', unitScale: '1', up: 'z', sealBase: 'true' });
  assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
  assert.equal(sealed.body.closed, true);
  assert.equal(sealed.body.sealedBase, true);
  assert.equal(sealed.body.report.sealedBase, true);
  assert.equal(sealed.body.report.gridVolumeMm3, 72000);
  assert.ok(sealed.body.report.warnings.some((w) => /underside was not scanned/.test(w)), JSON.stringify(sealed.body.report.warnings));
  const bad = await post({ voxelMm: '2', sealBase: 'yes' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error, 'pointcloud_refused');
  assert.match(bad.body.message, /sealBase must be true or false/);
});

test('deleting a job removes its rows and files', async () => {
  const dirs = fs.readdirSync(tmp);
  assert.ok(dirs.length >= 1);
  const del = await call(`/jobs/${jobId}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await call(`/jobs/${jobId}`)).status, 404);
  const remaining = fs.readdirSync(path.join(tmp, dirs[0]));
  assert.ok(!remaining.includes(jobId));
});
