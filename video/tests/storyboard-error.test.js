/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | A storyboard that does not come back says why. The page's own script, run against a stub DOM, presses Storyboard while POST /api/video/storyboard answers the installation's refusal (503 {detail:'unavailable: package call timed out', refused:'store_unavailable'}, seen live) or a route error; the hint must name the timeout / the route's reason and the HTTP status. It showed a bare 'storyboard failed'.
 * -----------------------------------------------------------------------------
 * @module storyboard-error.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'video.html'), 'utf8');

/** Run the main script with a stub DOM; POST /storyboard answers `answer`. Returns the storyboard hint after a press. */
async function pressStoryboard(answer) {
  const open = html.indexOf('<script>', html.indexOf('<body>'));
  const src = html.slice(open + 8, html.indexOf('</script>', open)) + '\n;return { storyboard };';
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: id === 'idea' ? 'A fox at dawn' : '20', textContent: '', innerHTML: '', className: '', title: '',
      disabled: false, style: {}, open: false, setAttribute() {}, focus() {}, dispatchEvent() {}, addEventListener() {} });
    return elements.get(id);
  };
  const fetchStub = (url) => {
    if (url === '/api/video/storyboard') return Promise.resolve({ ok: false, status: answer.status, json: () => (answer.body === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(answer.body)) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, videos: [], series: [], node: { available: true } }) });
  };
  const page = new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: undefined }, undefined,
    { getElementById: byId, querySelectorAll: () => [] }, fetchStub);
  await page.storyboard();
  return { hint: byId('sbHint').textContent, button: byId('sbBtn') };
}

test('a timed-out storyboard names the timeout and what to do', async () => {
  const { hint, button } = await pressStoryboard({ status: 503, body: { detail: 'unavailable: package call timed out', refused: 'store_unavailable' } });
  assert.equal(hint, 'The storyboard took longer than this installation allows for one request (unavailable: package call timed out). Press Storyboard again, or try a shorter idea.');
  assert.equal(button.disabled, false);
});

test('a route error and an unreadable answer each give the reason and the status', async () => {
  assert.equal((await pressStoryboard({ status: 400, body: { error: 'idea is too long' } })).hint, 'The storyboard could not be written: idea is too long (HTTP 400).');
  assert.equal((await pressStoryboard({ status: 502 })).hint, 'The storyboard could not be written: the server answered HTTP 502 with no reason it could read.');
  assert.equal((await pressStoryboard({ status: 503, body: { detail: 'no inference rail', refused: 'store_unavailable' } })).hint,
    'The storyboard could not be written: no inference rail [store_unavailable] (HTTP 503).');
});
