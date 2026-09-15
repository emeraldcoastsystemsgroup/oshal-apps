/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Execute the packaged handoff and output retirement in a Node VM with explicit DOM, HTTP and navigation ports; delayed contours cannot create a CAD part for another job or retired output. No browser, server, CAD engine or real data is used.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JOB = { job_id: '11111111-1111-4111-8111-111111111111', title: 'Synthetic box', updated_at: '2026-09-13T00:00:00Z' };
const CONTOURS = { views: { front: [[-30, 0], [30, 0], [30, 30], [-30, 30]] }, sizeMm: { x: 60, y: 40, z: 30 } };

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function response(status, body) { return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), json: async () => body }; }
function node() {
  return { hidden: true, textContent: '', children: [], setAttribute() {}, removeAttribute() {}, addEventListener() {},
    appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; } };
}

function surface() {
  const source = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.js'), 'utf8');
  const seam = "document.addEventListener('DOMContentLoaded', boot);";
  assert.equal(source.split(seam).length, 2, 'one boot seam exposes unchanged production closures to isolated ports');
  const elements = new Map(), requests = [], navigations = [];
  const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const control = { contour: async () => response(200, CONTOURS), cad: async () => response(201, { model: { title: JOB.title, revision: 1 } }) };
  const context = vm.createContext({ document: { getElementById: get, createElement: node },
    window: { location: { assign: url => navigations.push(url) } }, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method || 'GET', credentials: init.credentials, body: init.body && JSON.parse(init.body) });
      if (url === '/api/cad-studio/models') return control.cad();
      assert.match(url, /^\/api\/scan-to-print\/jobs\/[a-f0-9-]+\/artifacts\/contours$/);
      return control.contour();
    } });
  vm.runInContext(source.replace(seam, 'globalThis.surface = { state, openInCadStudio, clearOutputs };'), context);
  Object.assign(context.surface.state, { job: { ...JOB }, outputEpoch: 1, outputsFresh: true });
  return { ...context.surface, control, requests, navigations, get };
}

test('a current object sends its exact contours and source identity to the existing CAD route', async () => {
  const f = surface(); await f.openInCadStudio();
  assert.deepEqual(f.requests, [
    { url: `/api/scan-to-print/jobs/${JOB.job_id}/artifacts/contours`, method: 'GET', credentials: 'same-origin', body: undefined },
    { url: '/api/cad-studio/models', method: 'POST', credentials: 'same-origin', body: {
      title: JOB.title, base: { kind: 'contours', views: CONTOURS.views, size: CONTOURS.sizeMm },
      source: { kind: 'scan', jobId: JOB.job_id, title: JOB.title } } },
  ]);
  assert.deepEqual(f.navigations, ['/cockpit/?app=cad-studio']);
});

for (const change of ['switch', 'edit', 'revision', 'delete']) {
  test(`a held contour response after ${change} never creates or navigates to a CAD part`, async () => {
    const f = surface(), held = deferred(); f.control.contour = () => held.promise;
    const pending = f.openInCadStudio(); assert.equal(f.requests.length, 1);
    if (change === 'switch') f.state.job = { ...JOB, job_id: '22222222-2222-4222-8222-222222222222', title: 'Other object' };
    if (change === 'edit') f.clearOutputs('Scale changed. Save and reconstruct.');
    if (change === 'revision') f.state.job.updated_at = '2026-09-13T00:01:00Z';
    if (change === 'delete') f.state.job = null;
    held.resolve(response(200, CONTOURS)); await pending;
    assert.equal(f.requests.length, 1, 'no CAD POST'); assert.deepEqual(f.navigations, []);
  });
}

test('retired output cannot start a contour request through a retained callback', async () => {
  const f = surface(); f.clearOutputs('Reconstruct this object.'); await f.openInCadStudio();
  assert.deepEqual(f.requests, []); assert.deepEqual(f.navigations, []);
});

test('a late contour failure cannot replace the current object status', async () => {
  const f = surface(), held = deferred(); f.control.contour = () => held.promise;
  const pending = f.openInCadStudio(); f.clearOutputs('Newer edit');
  f.get('toast').textContent = 'Current object feedback';
  held.reject(new Error('Old contour read failed')); await pending;
  assert.equal(f.get('toast').textContent, 'Current object feedback');
  assert.equal(f.requests.length, 1); assert.deepEqual(f.navigations, []);
});

for (const status of [401, 403, 404, 409]) {
  test(`contour HTTP ${status} never creates a CAD part`, async () => {
    const f = surface(); f.control.contour = async () => response(status, { error: 'synthetic_contour_refusal' });
    await f.openInCadStudio(); assert.equal(f.requests.length, 1); assert.deepEqual(f.navigations, []);
    assert.equal(f.get('toast').textContent, 'synthetic_contour_refusal');
  });
}

for (const status of [401, 403, 404, 500]) {
  test(`CAD HTTP ${status} never navigates or retries the write`, async () => {
    const f = surface(); f.control.cad = async () => response(status, { error: 'synthetic_cad_failure' });
    await f.openInCadStudio(); assert.equal(f.requests.length, 2); assert.deepEqual(f.navigations, []);
    assert.match(f.get('toast').textContent, status === 500 ? /synthetic_cad_failure/ : /not installed.*not granted/);
  });
}

test('an edit while CAD creation completes retains the current page without retrying the write', async () => {
  const f = surface(), started = deferred(), held = deferred();
  f.control.cad = () => { started.resolve(); return held.promise; };
  const pending = f.openInCadStudio(); await started.promise;
  f.clearOutputs('New edit after request');
  held.resolve(response(201, { model: { title: JOB.title, revision: 1 } })); await pending;
  assert.equal(f.requests.length, 2); assert.deepEqual(f.navigations, []);
});
