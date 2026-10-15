/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 6: the Camera Ops header read 'SIM' while no camera existed and none was
 *   selected ('select a camera'): the pill was static 'SIM' in the page and applyTelemetry fell back to 'sim'. The shipped
 *   renderKindPill now hides it with no camera and names only the selected camera's own kind.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'camera-ops.html'), 'utf8');

function loadPill() {
  const a = html.indexOf('/* kind-pill:start */');
  const b = html.indexOf('/* kind-pill:end */');
  assert.ok(a > 0 && b > a, 'renderKindPill is marked in the page');
  const pill = { textContent: 'stale', style: { display: '' } };
  const render = new Function('$', html.slice(a, b) + '\nreturn renderKindPill;')(() => pill);
  return { pill, render };
}

test('the page ships no kind pill text before a camera is selected', () => {
  assert.match(html, /<span id="kindPill" class="pill" style="display:none"><\/span>/);
  assert.doesNotMatch(html, />SIM<\/span>/);
});

test('no camera selected: the pill is hidden and empty, never SIM', () => {
  const { pill, render } = loadPill();
  render(null);
  assert.equal(pill.textContent, '');
  assert.equal(pill.style.display, 'none');
});

test('a selected camera shows its own kind, and NODE when a node serves it', () => {
  const { pill, render } = loadPill();
  render({ kind: 'gopro', remote: true });
  assert.equal(pill.textContent, 'GOPRO · NODE');
  assert.equal(pill.style.display, '');
  render({ kind: 'sim', remote: false });
  assert.equal(pill.textContent, 'SIM');
  render({ remote: false });
  assert.equal(pill.style.display, 'none', 'a camera with no recorded kind is not called SIM');
});
