/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (sat-ops--sat-ops): a floating 'Prepare a diagnostic brief' pill with a hard-coded dark fill sat over the map, #btnAutoRot, #btnFrame, #catAdd and the per-satellite Remove were 20-26px, and 'Sat Ops — Fleet Plane' repeated the app bar. The page: the brief panel is moved into the right pane, takes theme colours and is never position:fixed; those four controls are 44px on touch and phone widths; the visible title is gone and the SIM FLEET badge stays.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sat-ops.html'), 'utf8');

test('the diagnostic brief panel lives in the right pane, in theme colours, never floating', () => {
  const css = /\.handoff-dock\{([^}]*)\}/.exec(html)[1];
  assert.match(css, /position:static/);
  assert.doesNotMatch(css, /position:fixed/);
  assert.doesNotMatch(html, /background:#142034/);
  assert.match(css, /background:var\(--panel\);color:var\(--text\)/);
  assert.match(html, /var r = document\.getElementById\('right'\), d = document\.getElementById\('evidenceReview'\); if \(r && d\) r\.appendChild\(d\);/);
});

test('the globe and catalog controls are 44px on touch and phone widths', () => {
  assert.match(html, /@media \(pointer: coarse\), \(max-width: 760px\) \{\s*#btnAutoRot, #btnFrame, #catAdd, \.sat-row \.remove \{ min-height: 44px; min-width: 44px;/);
});

test('named once: no visible "Sat Ops — Fleet Plane" title, the SIM FLEET badge stays', () => {
  assert.doesNotMatch(html, /<h1>🛰 Sat Ops — Fleet Plane<\/h1>/);
  assert.match(html, /<h1 class="sr-only">Sat Ops<\/h1>/);
  assert.match(html, /<span class="sim-badge">SIM FLEET/);
});
