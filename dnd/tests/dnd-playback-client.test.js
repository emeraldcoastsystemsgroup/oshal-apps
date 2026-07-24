/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-22 01:18:00 | roger.murphy@emeraldcoastsystemsgroup.com  | Execute timeline selection and scrubbing as read-only behavior, then prove restore remains inert until its separate confirmation.
 * 2026-07-23 11:10:07 | roger.murphy@emeraldcoastsystemsgroup.com  | Require the populated timeline header to expose a working Return to Game control.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'table-playback.js'), 'utf8');

/** @description Create the small DOM surface used by the playback client. */
function fakeElement(id, harness) {
  let html = '';
  return {
    id, dataset: {}, value: id === 'playbackSpeed' ? '1' : '', disabled: false, textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value || ''); harness.register(html, false); },
  };
}

/** @description Parse only ids and timeline data buttons from rendered markup. */
function registerMarkup(harness, html, reset) {
  if (reset) { harness.elements = {}; harness.indexButtons = []; }
  delete harness.elements.playbackRestore;
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const id = match[1];
    if (!harness.elements[id]) harness.elements[id] = fakeElement(id, harness);
  }
  for (const match of html.matchAll(/data-playback-index="(\d+)"/g)) {
    const button = fakeElement(`frame-${match[1]}`, harness);
    button.dataset.playbackIndex = match[1]; harness.indexButtons.push(button);
  }
  const scrubber = harness.elements.playbackScrubber;
  const value = /id="playbackScrubber"[^>]*value="(\d+)"/.exec(html);
  if (scrubber && value) scrubber.value = value[1];
}

/** @description Build a browser-like harness around the classic playback script. */
function playbackHarness() {
  const harness = { elements: {}, indexButtons: [], calls: [], entered: [], banners: [] };
  harness.register = (html, reset) => registerMarkup(harness, html, reset);
  harness.overlay = (html) => {
    registerMarkup(harness, String(html || ''), true);
    harness.elements.overlayCard = harness.elements.overlayCard || fakeElement('overlayCard', harness);
  };
  const frames = [
    { id: 'archive-1', type: 'archive', seq: 1, archiveSeq: 1, kind: 'combat', content: 'Bram attacks.', createdAt: '2026-07-22T00:01:00Z', fidelity: 'archive-only', fidelityNote: 'No exact board revision was captured; positions are not reconstructed.', board: null },
    { id: 'snapshot-s1', type: 'snapshot', snapshotId: 's1', archiveSeq: 1, label: 'At the cart', createdAt: '2026-07-22T00:02:00Z', fidelity: 'exact-board', fidelityNote: 'Exact saved board.', branch: 'current', restorable: true, board: { sceneId: 'coast-road', mode: 'combat', round: 2, tokens: [{ id: 'bram', kind: 'pc', name: 'Bram', x: 2, y: 3, hp: 8, maxHp: 12 }] } },
    { id: 'snapshot-old', type: 'snapshot', snapshotId: 'old', archiveSeq: 2, label: 'Prior fork', createdAt: '2026-07-22T00:03:00Z', fidelity: 'exact-board', fidelityNote: 'Prior branch.', branch: 'prior', restorable: false, board: { sceneId: 'coast-road', mode: 'combat', round: 3, tokens: [] } },
  ];
  const context = vm.createContext({
    console, campaign: null, board: null, content: { adventure: { scenes: [{ id: 'coast-road', title: 'Coast Road', grid: { w: 18, h: 12 } }] } },
    API: '/api/dnd', presentationClientId: 'presenter-test', document: { querySelectorAll: () => harness.indexButtons },
    $: (id) => harness.elements[id], overlay: harness.overlay, closeOverlay() {}, banner: (message) => harness.banners.push(message),
    esc: (value) => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    setInterval: () => 1, clearInterval() {}, quitToGameMenu() {}, loadSnapshot: () => { throw new Error('loaded active table unexpectedly'); },
    enterCampaign: async (id) => { harness.entered.push(id); return true; }, SC: () => null, createSnapshot: async () => null,
    api: async (url, options) => {
      harness.calls.push({ url, options: options || {} });
      if (url.startsWith('/playback?')) return { ok: true, readOnly: true, ended: true, campaign: { campaign_id: 'camp-1', is_owner: true }, coverage: { archiveEntries: 1, exactBoards: 2 }, frames };
      if (url === '/restore') return { ok: true };
      throw new Error('Unexpected client API: ' + url);
    },
  });
  vm.runInContext(source, context, { filename: 'table-playback.js' });
  return { harness, context };
}

test('selecting and scrubbing playback frames never calls a mutating route', async () => {
  const { harness, context } = playbackHarness();
  assert.equal(await context.showCampaignPlayback('camp-1', {}), true);
  assert.deepEqual(harness.calls.map((call) => call.url), ['/playback?campaignId=camp-1']);
  harness.elements.playbackScrubber.oninput({ target: { value: '0' } });
  context.selectPlaybackFrame(2); context.selectPlaybackFrame(1);
  assert.deepEqual(harness.calls.map((call) => call.url), ['/playback?campaignId=camp-1']);
  assert.ok(harness.elements.playbackRestore, 'current-branch exact snapshot should expose a separate restore action');
});

test('the populated timeline always returns through its visible header control', async () => {
  const { harness, context } = playbackHarness();
  let returned = 0;
  await context.showCampaignPlayback('camp-1', { back: () => { returned++; }, backLabel: 'Return to Game' });
  assert.ok(harness.elements.playbackClose, 'timeline header must expose Return to Game');
  harness.elements.playbackClose.onclick();
  assert.equal(returned, 1);
  assert.deepEqual(harness.calls.map((call) => call.url), ['/playback?campaignId=camp-1']);
});

test('restore remains inert until the exact snapshot confirmation is pressed', async () => {
  const { harness, context } = playbackHarness();
  await context.showCampaignPlayback('camp-1', {}); context.selectPlaybackFrame(1);
  harness.elements.playbackRestore.onclick();
  assert.deepEqual(harness.calls.map((call) => call.url), ['/playback?campaignId=camp-1']);
  assert.ok(harness.elements.playbackRestoreConfirm);
  await harness.elements.playbackRestoreConfirm.onclick();
  assert.deepEqual(harness.calls.map((call) => call.url), ['/playback?campaignId=camp-1', '/restore']);
  const restore = harness.calls[1];
  assert.equal(restore.options.method, 'POST');
  assert.deepEqual(JSON.parse(restore.options.body), { campaignId: 'camp-1', snapshotId: 's1', presenterId: 'presenter-test' });
  assert.deepEqual(harness.entered, ['camp-1']);
});

test('a prior-branch exact board is viewable but has no restore control', async () => {
  const { harness, context } = playbackHarness();
  await context.showCampaignPlayback('camp-1', {}); context.selectPlaybackFrame(2);
  assert.equal(harness.elements.playbackRestore, undefined);
  assert.deepEqual(harness.calls.map((call) => call.url), ['/playback?campaignId=camp-1']);
});
