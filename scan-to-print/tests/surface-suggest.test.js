/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The packaged "Suggest views from the video" closures (BACKLOG B12) in a Node VM with explicit DOM and HTTP ports: asking for suggestions sends only the read and lists one proposal per view with an assign control, names the views the clip never showed and says when proportions were not compared; "Assign all suggested" writes exactly the proposed frame to the proposed view, in order, and nothing else. No browser, server or real data is used.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JOB = { job_id: '11111111-1111-4111-8111-111111111111', title: 'Turntable', updated_at: '2026-09-14T00:00:00Z' };
const SUGGESTED = {
  frames: 17,
  suggestions: [
    { view: 'front', imageId: 'aaaaaaaa-0000-4000-8000-000000000003', fileName: 'frame-003.png', score: -0.05, skew: 0, turn: 0.05 },
    { view: 'right', imageId: 'aaaaaaaa-0000-4000-8000-000000000009', fileName: 'frame-009.png', score: -0.06, skew: 0, turn: 0.06 },
  ],
  unmatched: ['top', 'left', 'bottom'],
  proportionsKnown: 1,
};

function response(status, body) { return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) }; }
function node() {
  return { hidden: true, textContent: '', className: '', children: [], listeners: {}, setAttribute() {}, removeAttribute() {},
    addEventListener(kind, fn) { this.listeners[kind] = fn; },
    appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; } };
}

function surface(answer) {
  const source = fs.readFileSync(path.join(__dirname, '../tools/scan-to-print.js'), 'utf8');
  const seam = "document.addEventListener('DOMContentLoaded', boot);";
  assert.equal(source.split(seam).length, 2, 'one boot seam exposes unchanged production closures to isolated ports');
  const elements = new Map(), requests = [];
  const get = (id) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const context = vm.createContext({ document: { getElementById: get, createElement: node, createTextNode: (t) => ({ textContent: t }) },
    window: { location: { assign() {} } }, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method || 'GET', body: init.body && JSON.parse(init.body) });
      return answer(url, init);
    } });
  vm.runInContext(source.replace(seam, 'globalThis.surface = { state, suggestViews, assignAllSuggested };'), context);
  Object.assign(context.surface.state, { job: { ...JOB }, outputEpoch: 1, outputsFresh: true });
  return { ...context.surface, requests, get };
}

test('asking for suggestions only reads, and lists each proposal with an assign control', async () => {
  const f = surface(() => response(200, SUGGESTED));
  await f.suggestViews();
  assert.deepEqual(f.requests.map((r) => `${r.method} ${r.url}`), [`GET /api/scan-to-print/jobs/${JOB.job_id}/frame-suggestions`], 'nothing is assigned by asking');
  const items = f.get('suggest-list').children;
  assert.deepEqual(items.map((li) => li.children[0].textContent), ['front → frame-003.png', 'right → frame-009.png']);
  assert.ok(items.every((li) => li.children[1].textContent === 'assign' && typeof li.children[1].listeners.click === 'function'), 'each proposal waits for a click');
  assert.match(f.get('suggest-note').textContent, /No square-on frame for: top, left, bottom\./);
  assert.match(f.get('suggest-note').textContent, /Enter all three dimensions/, 'with one dimension known the proportions were not compared, and the page says so');
  assert.equal(f.get('suggest-all').hidden, false);
});

test('with nothing to propose, the assign-all control stays hidden', async () => {
  const f = surface(() => response(200, { frames: 17, suggestions: [], unmatched: ['top'], proportionsKnown: 3 }));
  await f.suggestViews();
  assert.equal(f.get('suggest-all').hidden, true);
  assert.deepEqual(f.get('suggest-list').children, []);
  assert.equal(f.get('suggest-note').textContent, 'No square-on frame for: top.');
});

test('assign-all writes exactly the proposed frame to the proposed view, in order', async () => {
  const f = surface((url, init) => (init.method === 'PATCH' ? response(200, { image: {} }) : url.endsWith('/frame-suggestions') ? response(200, SUGGESTED) : response(503, { error: 'stop here' })));
  await f.suggestViews();
  await assert.rejects(f.assignAllSuggested(), /stop here/, 'the job reload after the writes is outside this port');
  assert.deepEqual(f.requests.filter((r) => r.method === 'PATCH').map((r) => [r.url, r.body]), [
    [`/api/scan-to-print/jobs/${JOB.job_id}/images/${SUGGESTED.suggestions[0].imageId}`, { view: 'front' }],
    [`/api/scan-to-print/jobs/${JOB.job_id}/images/${SUGGESTED.suggestions[1].imageId}`, { view: 'right' }],
  ]);
  assert.equal(f.state.outputsFresh, false, 'assigning views retires the old outputs first');
});
