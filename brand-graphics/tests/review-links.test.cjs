/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Sweep 6: 'Open Vids Studio' was a plain <a href="/api/vids/app">, so
 *     |                                             | Vids Studio loaded inside the Brand Graphics frame, the bar still said
 *     |                                             | Brand Graphics and the only way back was its chip. Every link on the
 *     |                                             | review page that leaves Brand Graphics must hand off through the cockpit
 *     |                                             | (/cockpit/?app=<name>, target _top).
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review.html'), 'utf8');
const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  attrs: m[1], text: m[2].replace(/<[^>]+>/g, '').trim(),
  href: (/\bhref="([^"]*)"/.exec(m[1]) || [])[1] || '',
  target: (/\btarget="([^"]*)"/.exec(m[1]) || [])[1] || '',
}));

test('Open Vids Studio hands off to Vids in the cockpit, not inside this frame', () => {
  const vids = anchors.find((a) => a.text === 'Open Vids Studio');
  assert.ok(vids, 'the page offers Open Vids Studio');
  assert.equal(vids.href, '/cockpit/?app=vids');
  assert.equal(vids.target, '_top');
});

test('no link on the review page opens another app\'s screen inside this frame', () => {
  for (const a of anchors) {
    if (!a.href.startsWith('/')) continue;
    assert.ok(!/^\/api\/(?!brand-graphics\/)/.test(a.href), `${a.text} -> ${a.href} opens another app inside the frame`);
    if (a.href.startsWith('/cockpit/')) assert.equal(a.target, '_top', `${a.text} must leave the frame`);
  }
});
