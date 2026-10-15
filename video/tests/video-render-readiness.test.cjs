/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Generate video on an installation without a render executor: the page's own script, run against a stub DOM, disables Generate with "Video rendering is not configured on this installation" and the reason /pump/status gives (it had promised "Veo renders each scene" and then shown the raw "native_executor_unavailable"), keeps Generate on when the node is merely busy, and words a 503 refusal with the kernel's detail.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The subtitle under the title says rendering is not configured from the first paint and names what Storyboard it offers (sweep 9: the concierge, reading the screen before any storyboard, promised "a real .mp4"); a busy node keeps the render promise.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 13: the subtitle no longer promises the storyboard is saved as a project (it is not saved).
 * -----------------------------------------------------------------------------
 * @module video-render-readiness.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video.html'), 'utf8');
const REASON = 'native Video image/storyboard/render executor is not configured';

/** Run the main script with a stub DOM; /pump/status answers `node`. Returns the elements and the page's helpers. */
async function runPage(node) {
  const open = html.indexOf('<script>', html.indexOf('<body>'));
  const src = html.slice(open + 8, html.indexOf('</script>', open)) + '\n;return { generateError };';
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: '20', textContent: '', innerHTML: '', className: '', title: '', disabled: false,
      style: {}, open: false, setAttribute() {}, focus() {}, dispatchEvent() {}, addEventListener() {} });
    return elements.get(id);
  };
  const fetchStub = (url) => Promise.resolve({ ok: true, status: 200,
    json: () => Promise.resolve(url.startsWith('/api/video/pump/status') ? { ok: true, node } : { videos: [], series: [] }) });
  const page = new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: undefined }, undefined,
    { getElementById: byId, querySelectorAll: () => [] }, fetchStub);
  for (let i = 0; i < 3; i += 1) await new Promise((done) => setImmediate(done));
  return { genBtn: byId('genBtn'), genHint: byId('genHint'), studioSub: byId('studioSub'), page };
}

test('an installation without a render executor disables Generate and says why', async () => {
  const { genBtn, genHint } = await runPage({ available: false, check: 'native-render-unconfigured', reason: REASON });
  assert.equal(genBtn.disabled, true);
  assert.equal(genHint.textContent, `Video rendering is not configured on this installation (${REASON}).`);
  assert.equal(genBtn.title, genHint.textContent);
});

test('a busy render node leaves Generate on', async () => {
  const { genBtn, genHint } = await runPage({ available: false, check: 'busy', reason: 'rendering another episode' });
  assert.equal(genBtn.disabled, false);
  assert.equal(genHint.textContent, '');
});

test('a 503 refusal is worded with the kernel detail instead of the raw code', async () => {
  const { page } = await runPage({ available: true });
  assert.equal(page.generateError(503, { error: 'native_executor_unavailable', detail: 'video.render is unavailable' }),
    'Video rendering is not configured on this installation (video.render is unavailable).');
  assert.equal(page.generateError(502, { error: 'Veo quota exceeded' }), 'Veo quota exceeded');
});

test('the first paint says rendering is not configured and what Storyboard it offers, not a rendered .mp4', async () => {
  const { studioSub } = await runPage({ available: false, check: 'native-render-unconfigured', reason: REASON });
  assert.match(studioSub.textContent, new RegExp(`Video rendering is not configured on this installation \\(${REASON}\\)\\.`));
  assert.match(studioSub.textContent, /Storyboard it writes the scenes, narration and captions for you to read and edit here \(they are not saved\)/);
  assert.doesNotMatch(studioSub.textContent, /render a real short/);
  assert.match(html, /<div class="sub" id="studioSub">/, 'the subtitle is the element the page rewrites');
  const busy = await runPage({ available: false, check: 'busy', reason: 'rendering another episode' });
  assert.equal(busy.studioSub.textContent, '', 'a busy node leaves the render promise in the markup alone');
});
