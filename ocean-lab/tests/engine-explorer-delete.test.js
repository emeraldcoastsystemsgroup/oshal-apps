/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Live 2026-10-11: the Explorer tile had no Delete although DELETE /vehicles/:id exists, so a
 *                     |                             | created explorer could only be removed through the API. The shipped tools/explorer.js runs in a
 *                     |                             | vm with stub elements and a recording fetch (plain node, so it runs with the engine-* suites the
 *                     |                             | store gate runs): Delete asks first, a declined confirm sends nothing, a confirmed one sends
 *                     |                             | DELETE for the open vehicle and returns to the create card; a refusal keeps the record on screen.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | UX batch-7: Delete moves into the Stage card's ⋯ overflow menu with destructive styling and
 *                     |                             | opens an in-page confirm dialog (#delete-dialog, no native window.confirm); Cancel closes
 *                     |                             | without sending DELETE, and Delete explorer sends DELETE /api/ocean-lab/vehicles/:id.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'tools', 'explorer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'explorer.html'), 'utf8');
const VEHICLE = '925f0106-1111-4222-8333-444455556666';

/** A minimal element: hidden flag, text, html, value, listeners and a query for the tables' tbody. */
function element(initialHidden = false) {
  const listeners = {};
  const self = {
    hidden: initialHidden, textContent: '', innerHTML: '', value: '', href: '', listeners,
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector() { return self; },
  };
  return self;
}

/** The smallest record the tile renders: a concept explorer with no runs. */
const RECORD = {
  vehicle: {
    vehicleId: VEHICLE, kind: 'wave-explorer',
    designVector: {
      wings: { count: 4, spanM: 0.4, chordM: 0.1, section: 'NACA0012', stopAngleDeg: 20 },
      tether: { lengthM: 4, diameterM: 0.004 }, float: { displacementL: 20 }, sub: { netWeightN: 30 },
    },
  },
  stage: { stage: 'concept', reached: ['concept'], because: 'not evaluated', next: 'sized', blockedBy: ['evaluate'], fabricable: 'Not fabricable yet.', openLimits: [], currentVectorFingerprint: 'f1' },
  runs: [],
};
const KINDS = { stages: ['concept', 'sized'], seed: { provenance: {} }, evaluationPlant: 'wave-explorer-plant' };

/** Run the shipped script with stubbed DOM and a fetch that serves the caller's one explorer. */
async function boot({ deleteStatus }) {
  const els = { 'delete-dialog': element(true), 'stage-more-menu': element(true) };
  const document = { getElementById: (id) => { if (!els[id]) els[id] = element(); return els[id]; } };
  const calls = [];
  const answer = (status, body) => Promise.resolve({ status, text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)) });
  const fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    if (method === 'DELETE') return answer(deleteStatus, deleteStatus === 204 ? undefined : { error: 'vehicle_not_found' });
    if (url === '/api/ocean-lab/vehicles/kinds') return answer(200, KINDS);
    if (url === '/api/ocean-lab/vehicles') return answer(200, { vehicles: [{ vehicle: RECORD.vehicle }] });
    if (url === `/api/ocean-lab/vehicles/${VEHICLE}`) return answer(200, RECORD);
    return answer(404, { error: 'not_found' });
  };
  const window = {};
  vm.runInNewContext(SCRIPT, { window, document, fetch, Promise, Object, String, JSON, isFinite });
  window.OceanExplorer.start();
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(els.record.hidden, false, 'the explorer record is on screen before Delete');
  calls.length = 0;
  return { els, calls };
}

const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

test('the tile carries a destructive Delete control inside the Stage card overflow menu and an in-page confirm dialog', () => {
  assert.match(HTML, /id="stage-more-menu"[\s\S]*?<button class="menu-item destructive" id="delete-explorer" type="button"[^>]*>Delete this explorer<\/button>/);
  assert.match(HTML, /<dialog class="confirm-dialog" id="delete-dialog"[\s\S]*?id="delete-cancel"[\s\S]*?id="delete-confirm"/);
  assert.doesNotMatch(SCRIPT, /global\.confirm\(/, 'no native window.confirm is used');
  assert.match(SCRIPT, /el\('delete-explorer'\)\.addEventListener\('click', deleteExplorer\)/);
  assert.match(SCRIPT, /el\('delete-confirm'\)\.addEventListener\('click', confirmDeleteExplorer\)/);
});

test('a declined confirm sends nothing', async () => {
  const page = await boot({ deleteStatus: 204 });
  page.els['delete-explorer'].listeners.click();
  assert.equal(page.els['delete-dialog'].hidden, false, 'in-page confirm opens first');
  assert.deepEqual(page.calls, []);
  page.els['delete-cancel'].listeners.click();
  await settle();
  assert.equal(page.els['delete-dialog'].hidden, true);
  assert.deepEqual(page.calls, []);
  assert.equal(page.els.record.hidden, false);
});

test('a confirmed delete removes the open vehicle and offers to create one again', async () => {
  const page = await boot({ deleteStatus: 204 });
  page.els['delete-explorer'].listeners.click();
  page.els['delete-confirm'].listeners.click();
  await settle();
  assert.deepEqual(page.calls, [{ url: `/api/ocean-lab/vehicles/${VEHICLE}`, method: 'DELETE' }]);
  assert.equal(page.els.record.hidden, true);
  assert.equal(page.els['no-vehicle'].hidden, false);
  assert.match(page.els.status.textContent, /The explorer is deleted/);
});

test('a refused delete keeps the record on screen and says why', async () => {
  const page = await boot({ deleteStatus: 404 });
  page.els['delete-explorer'].listeners.click();
  page.els['delete-confirm'].listeners.click();
  await settle();
  assert.equal(page.els.record.hidden, false);
  assert.match(page.els.status.textContent, /was not deleted \(404: vehicle_not_found\)/);
});
