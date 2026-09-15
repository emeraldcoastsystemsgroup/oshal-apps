/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real reconstruction and HTTP freshness boundaries with synthetic photos, isolated files and printer/process doubles; no live devices or database.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require CAD contours to retire and refuse stale reads alongside every existing artifact.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture, json, photo, readyJob } = require('./routes-core.fixture.js');
let f;
test.beforeEach(async () => { f = await startFixture(); });
test.afterEach(async () => { await f.close(); });
const patch = (id, body) => f.call(`/jobs/${id}`, json('PATCH', body));
const rebuild = (id) => f.call(`/jobs/${id}/reconstruct`, json('POST', {}));

async function printer() {
  const res = await f.call('/printers', json('POST', { label: 'Synthetic printer', kind: 'octoprint', baseUrl: 'http://printer.invalid', apiKey: 'fixture-only' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.printer.printer_id;
}

async function stale(id, printerId) {
  const detail = await f.call(`/jobs/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.job.report, null);
  assert.deepEqual(detail.body.artifacts, { stl: false, obj: false, svg: false, report: false, gcode: false, contours: false });
  const network = f.fetchCalls.length, processes = f.execCalls.length;
  for (const key of ['stl', 'obj', 'svg', 'report', 'gcode', 'contours']) {
    const res = await f.call(`/jobs/${id}/artifacts/${key}?download`);
    assert.equal(res.status, 409, key + ': ' + JSON.stringify(res.body));
    assert.equal(res.body.error, 'output_stale');
    assert.match(res.headers.get('cache-control'), /private, no-store/);
  }
  for (const [route, body] of [['print', { printerId, fileKind: 'stl', confirm: true }], ['print', { printerId, fileKind: 'gcode', confirm: true }]]) {
    const res = await f.call(`/jobs/${id}/${route}`, json('POST', body));
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error, 'output_stale');
  }
  assert.equal(f.fetchCalls.length, network, 'no stale output reaches a printer');
  assert.equal(f.execCalls.length, processes, 'no stale output reaches a slicer');
}

async function stlExtent(id) {
  const res = await fetch(f.base + `/jobs/${id}/artifacts/stl`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /private, no-store/);
  const bytes = Buffer.from(await res.arrayBuffer());
  let lo = Infinity, hi = -Infinity;
  for (let face = 0; face < bytes.readUInt32LE(80); face += 1) for (let vertex = 0; vertex < 3; vertex += 1) {
    const x = bytes.readFloatLE(84 + face * 50 + 12 + vertex * 12);
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  return { x: hi - lo, bytes };
}

test('changing reconstructed width60 to80 retires every output and rebuild exports the updated extent', async () => {
  const { id } = await readyJob(f), printerId = await printer();
  const old = await stlExtent(id);
  assert.ok(Math.abs(old.x - 60) < 0.001);
  f.env.SCAN_TO_PRINT_SLICER_CMD = 'fixture-slicer {input} {output}';
  assert.equal((await f.call(`/jobs/${id}/print`, json('POST', { printerId, fileKind: 'gcode', confirm: true }))).status, 201);
  assert.equal((await patch(id, { knownDimensions: [{ axis: 'x', mm: 80 }] })).status, 200);
  await stale(id, printerId);
  const fresh = await rebuild(id);
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.equal(fresh.body.report.sizeMm.x, 80);
  const current = await stlExtent(id);
  assert.ok(Math.abs(current.x - 80) < 0.001);
  assert.notDeepEqual(current.bytes, old.bytes);
  assert.equal((await f.call(`/jobs/${id}`)).body.artifacts.gcode, false);
  assert.equal(f.fetchCalls.length, 1, 'only the original fresh positive control contacted the printer double');
});

for (const change of ['photo', 'view', 'remove', 'settings', 'title']) {
  test(`${change} changes retire existing photos-derived artifacts before downstream use`, async () => {
    const { id, images } = await readyJob(f), printerId = await printer();
    let res;
    if (change === 'photo') res = await f.uploadPhotos(id, [['extra.png', await photo(40, 20)]]);
    if (change === 'view') res = await f.call(`/jobs/${id}/images/${images[0].image_id}`, json('PATCH', { view: 'back' }));
    if (change === 'remove') res = await f.call(`/jobs/${id}/images/${images[0].image_id}`, { method: 'DELETE' });
    if (change === 'settings') res = await patch(id, { settings: { resolution: 40, smoothIterations: 1 } });
    if (change === 'title') res = await patch(id, { title: 'Changed drawing title' });
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));
    await stale(id, printerId);
    assert.equal(f.fetchCalls.length, 0);
  });
}

test('unchanged inputs and rejected invalid patches retain the exact current output', async () => {
  const { id } = await readyJob(f), original = await stlExtent(id);
  assert.equal((await patch(id, { title: 'Synthetic box', knownDimensions: [{ axis: 'x', mm: 60 }], settings: { resolution: 32, smoothIterations: 0 } })).status, 200);
  assert.equal((await patch(id, { knownDimensions: [{ axis: 'x', mm: -5 }] })).status, 400);
  assert.equal((await patch(id, { settings: { resolution: -1 } })).status, 400);
  assert.deepEqual((await stlExtent(id)).bytes, original.bytes);
  assert.equal((await f.call(`/jobs/${id}`)).body.job.state, 'reconstructed');
});

function boxPly() {
  const pts = [];
  for (let a = 0; a <= 20; a += 1) for (let b = 0; b <= 16; b += 1) pts.push([a, b, 0], [a, b, 12]);
  for (let a = 0; a <= 20; a += 1) for (let c = 0; c <= 12; c += 1) pts.push([a, 0, c], [a, 16, c]);
  for (let b = 0; b <= 16; b += 1) for (let c = 0; c <= 12; c += 1) pts.push([0, b, c], [20, b, c]);
  return `ply\nformat ascii 1.0\nelement vertex ${pts.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${pts.map((p) => p.join(' ')).join('\n')}\n`;
}

async function ply(id, bytes, settings = {}) {
  const body = new FormData();
  body.append('model', new Blob([bytes]), 'synthetic.ply');
  body.append('voxelMm', '2'); body.append('unitScale', '1'); body.append('up', 'z');
  for (const [key, value] of Object.entries(settings)) body.append(key, String(value));
  return f.call(`/jobs/${id}/pointcloud`, { method: 'POST', body });
}

test('failed PLY replacement retires old geometry and a valid replacement publishes only its own mesh', async () => {
  const { id } = await readyJob(f), printerId = await printer();
  const failed = await ply(id, 'not a PLY document');
  assert.equal(failed.status, 422, JSON.stringify(failed.body));
  await stale(id, printerId);
  const good = await ply(id, boxPly());
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(good.body.report.lane, 'pointcloud');
  assert.equal(good.body.closed, true);
  assert.ok(Math.abs((await stlExtent(id)).x - good.body.report.boundsMm.size.x) < 0.001);
  assert.notEqual(good.body.report.sizeMm.x, 60);
  assert.equal(f.fetchCalls.length, 0);
});

test('a failed rebuild cannot advertise or return the last successful model', async () => {
  const { id, images } = await readyJob(f), printerId = await printer();
  const ownerDir = fs.readdirSync(f.tmp)[0];
  fs.writeFileSync(path.join(f.tmp, ownerDir, id, 'masks', images[0].image_id + '.png'), 'broken synthetic mask');
  const failed = await rebuild(id);
  assert.ok([422, 500].includes(failed.status), JSON.stringify(failed.body));
  await stale(id, printerId);
  assert.equal(f.fetchCalls.length, 0);
});

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('an in-flight rebuild refuses overlapping input changes and a later accepted change invalidates its result', async () => {
  const { id } = await readyJob(f), printerId = await printer(), entered = signal(), release = signal();
  f.control.beforeQuery = async (sql) => {
    if (sql.startsWith('SELECT') && sql.includes('FROM scan_print_image')) {
      f.control.beforeQuery = null; entered.resolve(); await release.promise;
    }
  };
  const running = rebuild(id);
  try {
    await entered.promise;
    const changed = await patch(id, { knownDimensions: [{ axis: 'x', mm: 80 }] });
    assert.equal(changed.status, 409); assert.equal(changed.body.error, 'job_busy');
    const again = await rebuild(id);
    assert.equal(again.status, 409); assert.equal(again.body.error, 'job_busy');
    const cloud = await ply(id, boxPly());
    assert.equal(cloud.status, 409); assert.equal(cloud.body.error, 'job_busy');
    const video = new FormData();
    video.append('video', new Blob(['synthetic video bytes']), 'held.mp4');
    const clip = await f.call(`/jobs/${id}/video`, { method: 'POST', body: video });
    assert.equal(clip.status, 409); assert.equal(clip.body.error, 'job_busy');
    const owner = fs.readdirSync(f.tmp)[0];
    assert.deepEqual(fs.readdirSync(path.join(f.tmp, owner, id, 'uploads')), [], 'busy uploads leave no files');
  } finally { release.resolve(); }
  assert.equal((await running).status, 200);
  assert.equal((await patch(id, { knownDimensions: [{ axis: 'x', mm: 80 }] })).status, 200);
  await stale(id, printerId);
});

test('in-flight slicing serializes input changes and cannot leave cached G-code current after the next change', async () => {
  const { id } = await readyJob(f), printerId = await printer(), entered = signal(), release = signal();
  f.env.SCAN_TO_PRINT_SLICER_CMD = 'fixture-slicer {input} {output}';
  f.control.execFile = async (_file, args) => {
    entered.resolve(); await release.promise; fs.writeFileSync(args.at(-1), 'G28\nG1 X60\n');
    return { stdout: '', stderr: '' };
  };
  const running = f.call(`/jobs/${id}/print`, json('POST', { printerId, fileKind: 'gcode', confirm: true }));
  try {
    await entered.promise;
    const changed = await patch(id, { knownDimensions: [{ axis: 'x', mm: 80 }] });
    assert.equal(changed.status, 409); assert.equal(changed.body.error, 'job_busy');
    assert.equal(f.fetchCalls.length, 0, 'printer is not contacted until slicing finishes');
  } finally { release.resolve(); }
  assert.equal((await running).status, 201);
  assert.equal((await patch(id, { knownDimensions: [{ axis: 'x', mm: 80 }] })).status, 200);
  await stale(id, printerId);
  assert.equal(f.fetchCalls.length, 1, 'only the explicitly confirmed current output was sent');
});

test('a persisted current nonprintable model remains inspectable but cannot reach slicer or printer', async () => {
  const { id } = await readyJob(f), printerId = await printer();
  f.env.SCAN_TO_PRINT_SLICER_CMD = 'fixture-slicer {input} {output}';
  const row = f.pool.tables.scan_print_job.find((entry) => entry.job_id === id);
  row.report.printable = false;
  const owner = fs.readdirSync(f.tmp)[0];
  fs.writeFileSync(path.join(f.tmp, owner, id, 'artifacts', 'report.json'), JSON.stringify(row.report));
  assert.equal((await f.call(`/jobs/${id}/artifacts/report`)).body.printable, false);
  assert.equal((await f.call(`/jobs/${id}/artifacts/stl`)).status, 200);
  for (const fileKind of ['stl', 'gcode']) {
    const res = await f.call(`/jobs/${id}/print`, json('POST', { printerId, fileKind, confirm: true }));
    assert.equal(res.status, 409); assert.equal(res.body.error, 'model_not_printable');
  }
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.execCalls.length, 0);
});

test('failed slicing removes partial G-code and a subsequent explicit retry can succeed', async () => {
  const { id } = await readyJob(f), printerId = await printer();
  f.env.SCAN_TO_PRINT_SLICER_CMD = 'fixture-slicer {input} {output}';
  f.control.execFile = async (_file, args) => {
    fs.writeFileSync(args.at(-1), 'incomplete G-code');
    throw new Error('Synthetic slicing failure');
  };
  const send = () => f.call(`/jobs/${id}/print`, json('POST', { printerId, fileKind: 'gcode', confirm: true }));
  const failed = await send();
  assert.equal(failed.status, 502); assert.equal(failed.body.error, 'slicer_failed');
  assert.equal((await f.call(`/jobs/${id}`)).body.artifacts.gcode, false);
  assert.equal((await f.call(`/jobs/${id}/artifacts/gcode`)).status, 404);
  assert.equal(f.fetchCalls.length, 0);
  f.control.execFile = null;
  assert.equal((await send()).status, 201);
  assert.equal((await f.call(`/jobs/${id}/artifacts/gcode`)).status, 200);
  assert.equal(f.fetchCalls.length, 1);
});

for (const lane of ['photos', 'pointcloud']) {
  test(`${lane} rebuild persists its effective settings so changing back retires the overridden output`, async () => {
    const { id } = await readyJob(f), printerId = await printer();
    const res = lane === 'photos' ? await f.call(`/jobs/${id}/reconstruct`, json('POST', { smoothIterations: 1 }))
      : await ply(id, boxPly(), { smoothIterations: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await f.call(`/jobs/${id}`)).body.job.settings.smoothIterations, 1);
    assert.equal((await patch(id, { settings: { resolution: 32, smoothIterations: 0 } })).status, 200);
    await stale(id, printerId);
  });
}
