/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Scan to Print page states and enforces the upload limit that holds on this installation. The shipped helpers and upload handlers (cut out of tools/scan-to-print.js and run with recording doubles for the request, toast and output-clearing seams) prove: an 11 MiB .ply or video under the native 10 MiB cap is refused before anything is sent and before the outputs are cleared, naming its size, the limit and how to make it fit; a .ply under the cap is sent once; photos go in requests that each fit 10 MiB and 12 files, an oversized photo is named and not sent; the note under Capture names the native cap. Before this the page sent the file and the kernel answered 413 (or, inside its body cap, 500).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'scan-to-print.js'), 'utf8');

/** Cut one shipped function (sync or async) out of the page script, braces balanced. */
function cut(name) {
  const start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start > 0, `the surface declares ${name}`);
  let depth = 0;
  let end = source.indexOf('{', start);
  for (; end < source.length; end += 1) { if (source[end] === '{') depth += 1; else if (source[end] === '}' && --depth === 0) break; }
  return source.slice(start, end + 1);
}

const MiB = 1024 * 1024;
const NATIVE = { host: 'native', imageBytes: 10 * MiB, imagesPerRequest: 12, imagesPerJob: 24, videoBytes: 10 * MiB, plyBytes: 10 * MiB,
  depthBytes: 10 * MiB, requestBytes: 10 * MiB };

/** A page sandbox: the shipped helpers and handlers over recording doubles. */
function page(upload) {
  const calls = { api: [], toasts: [], cleared: [] };
  const fields = { 'pc-voxel': { value: '1' }, 'pc-units': { value: '1000' }, 'pc-up': { value: 'y' }, 'pc-seal': { checked: false } };
  const sandbox = {
    state: { capabilities: upload ? { upload } : null, job: { job_id: 'job-1' } },
    $: (id) => fields[id],
    toast: (message, kind) => calls.toasts.push({ message, kind }),
    clearOutputs: (message) => calls.cleared.push(message),
    openJob: async () => undefined,
    api: async (route, opts) => { calls.api.push({ route, files: opts.body.files }); return { closed: true, frames: 3, viewsFromMarkers: 0 }; },
    FormData: class { constructor() { this.files = []; } append(name, value) { if (typeof value === 'object') this.files.push(value.name); } },
  };
  vm.createContext(sandbox);
  const names = ['sizeText', 'planUpload', 'tooLargeText', 'uploadNote', 'uploadLimits', 'uploadPhotos', 'uploadVideo', 'uploadPointCloud'];
  new vm.Script(`${names.map(cut).join('\n')}\n${names.map((n) => `globalThis.${n} = ${n};`).join('\n')}`).runInContext(sandbox);
  return { sandbox, calls };
}
const file = (name, mib) => ({ name, size: Math.round(mib * MiB) });
/** Batch sizes, copied out of the page's realm. */
const sizes = (plan) => Array.from(plan.batches, (b) => b.length);

test('an oversized .ply is refused before anything is sent or cleared, with its size, the cap and how to make it fit', async () => {
  const { sandbox, calls } = page(NATIVE);
  await sandbox.uploadPointCloud(file('scan.ply', 11));
  assert.deepEqual(calls.api, [], 'nothing is sent');
  assert.deepEqual(calls.cleared, [], 'the current outputs stay');
  assert.equal(calls.toasts.length, 1);
  assert.equal(calls.toasts[0].kind, 'error');
  assert.equal(calls.toasts[0].message, 'scan.ply is 11 MiB; this installation accepts files up to 10 MiB. A binary .ply export, or a decimated or cropped scan, is smaller.');
});

test('a .ply under the cap is sent once, and a video over it is refused the same way', async () => {
  const { sandbox, calls } = page(NATIVE);
  await sandbox.uploadPointCloud(file('small.ply', 9.5));
  assert.deepEqual(calls.api.map((c) => c.route), ['/jobs/job-1/pointcloud']);
  await sandbox.uploadVideo(file('clip.mp4', 42.3));
  assert.equal(calls.api.length, 1, 'the video is not sent');
  assert.match(calls.toasts.at(-1).message, /^clip\.mp4 is 42\.3 MiB; this installation accepts files up to 10 MiB\. Trim the clip/);
});

test('photos go in requests that each fit the native request bound; an oversized photo is named and not sent', async () => {
  const { sandbox, calls } = page(NATIVE);
  const photos = [file('a.jpg', 4), file('b.jpg', 4), file('big.jpg', 12), file('c.jpg', 4), file('d.jpg', 1), file('e.jpg', 4)];
  await sandbox.uploadPhotos(photos);
  assert.deepEqual(calls.api.map((c) => c.files), [['a.jpg', 'b.jpg'], ['c.jpg', 'd.jpg', 'e.jpg']]);
  const last = calls.toasts.at(-1);
  assert.equal(last.kind, 'error');
  assert.equal(last.message, 'Photos added. Not sent (over 10 MiB): big.jpg.');
});

test('the plan keeps at most perRequest files per request, and with no request bound only that count splits', () => {
  const { sandbox } = page(NATIVE);
  const many = Array.from({ length: 14 }, (_, i) => file(`p${i}.jpg`, 0.1));
  assert.deepEqual(sizes(sandbox.planUpload(many, 10 * MiB, 10 * MiB, 12)), [12, 2]);
  assert.deepEqual(sizes(sandbox.planUpload([file('x', 30), file('y', 30)], 50 * MiB, null, 12)), [2]);
});

test('the note under Capture names the limit that holds here', () => {
  const { sandbox } = page(NATIVE);
  assert.equal(sandbox.uploadNote(NATIVE), 'Uploads on this installation: at most 10 MiB per file (photo, video or .ply).');
  assert.equal(sandbox.uploadNote({ host: 'declared', imageBytes: 25 * MiB, videoBytes: 300 * MiB, plyBytes: 200 * MiB }),
    'Upload limits: photos 25 MiB, video 300 MiB, .ply 200 MiB each.');
  assert.equal(sandbox.uploadNote(null), '');
});

test('without a capabilities answer the page still sends (the server keeps refusing what it cannot take)', async () => {
  const { sandbox, calls } = page(null);
  await sandbox.uploadPointCloud(file('scan.ply', 11));
  assert.equal(calls.api.length, 1);
});
