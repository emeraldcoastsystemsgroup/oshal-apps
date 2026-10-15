/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: a one-scene storyboard read "3 · STORYBOARD · 1 SCENES · ~4S", and
 *   the subtitle promised a storyboard "to edit and save as a project" though the section has no save control and the
 *   storyboard is gone on reload. The page's main script, run as shipped over a stub DOM, says "1 scene" (and "1 scene"
 *   in My videos) and says the storyboard is not saved.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video.html'), 'utf8');

/** Run the main script with a stub DOM and the given storyboard / list answers. */
async function runPage(scenes, videos) {
  const open = html.indexOf('<script>', html.indexOf('<body>'));
  const src = html.slice(open + 8, html.indexOf('</script>', open)) + '\n;return { storyboard, loadList };';
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: id === 'idea' ? 'a lighthouse at dawn' : '20', textContent: '', innerHTML: '', className: '',
      title: '', disabled: false, style: {}, open: false, setAttribute() {}, focus() {}, dispatchEvent() {}, addEventListener() {}, appendChild() {} });
    return elements.get(id);
  };
  const json = (url) => (url.startsWith('/api/video/pump/status') ? { ok: true, node: { available: false, check: 'native-render-unconfigured', reason: 'x' } }
    : url.startsWith('/api/video/storyboard') ? { storyboard: { title: 'Dawn', scenes }, seconds: 4, estCostUsd: 0 }
      : { videos, series: [] });
  const fetchStub = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json(url)) });
  const document = { getElementById: byId, querySelectorAll: () => [], createElement: () => ({ set innerHTML(v) { this.html = v; } }) };
  const page = new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: undefined }, undefined, document, fetchStub);
  for (let i = 0; i < 3; i += 1) await new Promise((done) => setImmediate(done));
  return { page, byId };
}

const scene = { prompt: 'a lighthouse', durationSec: 4, narration: '', caption: '' };

test('a one-scene storyboard and a one-scene video say "1 scene"', async () => {
  const one = await runPage([scene], [{ title: 'Dawn', seconds: 4, scenes: 1 }]);
  await one.page.storyboard();
  assert.equal(one.byId('sbMeta').textContent, '· 1 scene · ~4s · est ~$0');
  await one.page.loadList();
  assert.match(one.byId('list').innerHTML, /4s · 1 scene · /);
  const two = await runPage([scene, scene], [{ title: 'Dawn', seconds: 8, scenes: 2 }]);
  await two.page.storyboard();
  assert.equal(two.byId('sbMeta').textContent, '· 2 scenes · ~4s · est ~$0');
  await two.page.loadList();
  assert.match(two.byId('list').innerHTML, /8s · 2 scenes · /);
});

test('the subtitle says the storyboard is edited here and not saved', async () => {
  const { byId } = await runPage([scene], []);
  const sub = byId('studioSub').textContent;
  assert.match(sub, /Storyboard it writes the scenes, narration and captions for you to read and edit here \(they are not saved\)/);
  assert.doesNotMatch(sub, /save as a project/);
});
