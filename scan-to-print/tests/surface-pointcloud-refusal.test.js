/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | K4 regression: a refused point-cloud import (POST /jobs/:id/pointcloud -> 422 "Voxel 1 mm is too fine for a 30000.0 mm object (limit 200 per axis)") left the report on "Processing the new point cloud. Previous outputs are unavailable." indefinitely, the reason only a passing toast. Runs the surface's own uploadPointCloud and showImportRefusal over doubles of the page helpers: after the refusal the object is reloaded and the report says why, in an alert, and no "Processing" text is left behind. A successful import is unchanged.
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

/** The source text of one named function in the surface, by brace matching. */
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `the surface declares ${name}`);
  const from = source.lastIndexOf('async ', start) === start - 6 ? start - 6 : start;
  let depth = 0; let end = source.indexOf('{', start);
  for (; end < source.length; end += 1) { if (source[end] === '{') depth += 1; else if (source[end] === '}' && --depth === 0) break; }
  return source.slice(from, end + 1);
}

/** A page double: the report card, the inputs the import reads, and the helpers it calls. */
function page(answer) {
  const report = { children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const inputs = { 'pc-voxel': { value: '1' }, 'pc-units': { value: '1000' }, 'pc-up': { value: 'z' }, 'pc-seal': { checked: false }, report };
  const toasts = []; const opened = [];
  const sandbox = {
    state: { job: { job_id: 'job-1' } }, FormData: class { append() {} },
    $: (id) => inputs[id],
    el: (tag, attrs) => ({ tag, ...attrs }),
    uploadLimits: () => ({ plyBytes: 10 * 1024 * 1024 }), tooLargeText: () => 'too large',
    clearOutputs: (message) => { report.replaceChildren({ tag: 'p', role: 'status', text: message }); },
    toast: (text, kind) => toasts.push([text, kind]),
    openJob: async (id) => { opened.push(id); report.replaceChildren({ tag: 'p', role: 'status', text: 'Point cloud import refused: reloaded job' }); },
    api: async () => { if (answer instanceof Error) throw answer; return answer; },
  };
  vm.createContext(sandbox);
  new vm.Script(`${fn('showImportRefusal')}\n${fn('uploadPointCloud')}\nglobalThis.uploadPointCloud = uploadPointCloud;`).runInContext(sandbox);
  return { run: (file) => sandbox.uploadPointCloud(file), report, toasts, opened };
}

test('a refused import keeps the reason in the report, after reloading the object, and leaves no Processing text', async () => {
  const p = page(new Error('Voxel 1 mm is too fine for a 30000.0 mm object (limit 200 per axis)'));
  await p.run({ name: 'room.ply', size: 4096 });
  assert.deepEqual(p.opened, ['job-1'], 'the object is reloaded as the server now holds it');
  assert.equal(p.report.children.length, 1);
  const shown = p.report.children[0];
  assert.equal(shown.role, 'alert');
  assert.match(shown.text, /^The point cloud was not imported: Voxel 1 mm is too fine for a 30000\.0 mm object \(limit 200 per axis\)/);
  assert.doesNotMatch(JSON.stringify(p.report.children), /Processing the new point cloud/);
  assert.deepEqual(p.toasts.at(-1), ['Voxel 1 mm is too fine for a 30000.0 mm object (limit 200 per axis)', 'error']);
});

test('a successful import still reloads the object and toasts the outcome', async () => {
  const p = page({ closed: true, sealedBase: false });
  await p.run({ name: 'part.ply', size: 4096 });
  assert.deepEqual(p.opened, ['job-1']);
  assert.deepEqual(p.toasts.at(-1), ['Point cloud closed and filled.', 'ok']);
  assert.ok(!p.report.children.some((c) => c.role === 'alert'));
});
