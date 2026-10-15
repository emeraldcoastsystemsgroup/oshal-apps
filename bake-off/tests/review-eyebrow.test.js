/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 8: the AI Bake-Off Review page's eyebrow read 'Learning and
 *                     |                             | recreation' while the package's suite is ai-engineering (listed under
 *                     |                             | Engineering). The served page's eyebrow names the same room as the
 *                     |                             | manifest suite and the page's own audience-view kicker.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROOM_FOR_SUITE = { 'ai-engineering': 'Engineering' };

test('the Review eyebrow names the room of the manifest suite', () => {
  const suite = (fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8').match(/^suite:\s*([a-z-]+)/m) || [])[1];
  const room = ROOM_FOR_SUITE[suite];
  assert.ok(room, `no room label known for suite ${suite}`);
  const html = fs.readFileSync(path.join(PKG, 'tools', 'review.html'), 'utf8');
  const eyebrows = [...html.matchAll(/<div class="eyebrow">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(eyebrows, [room]);
  assert.match(html, new RegExp(`var KICKER = '${room} · AI Bake-Off'`));
  assert.doesNotMatch(html, /Learning and recreation/);
});
