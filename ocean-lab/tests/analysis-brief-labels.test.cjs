/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13 found Aero Lab's analysis brief labelled with HTML element ids;
 *   Blade Studio and Harvest Console wrote theirs the same way ("kpi-margin: ...", "mode-badge: ..."). Each page's own
 *   "Use visible results" handler, run as shipped with a stub DOM, must label every line in the words on screen.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Run a page's "Use visible results" handler with a stub DOM whose every element reads "x"; returns the brief. */
function brief(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', file), 'utf8');
  const start = html.indexOf("document.getElementById('captureLabEvidence').addEventListener('click',");
  const end = html.indexOf(');});', start) + 5;
  assert.ok(start > 0 && end > start, `${file} has the capture handler`);
  const notes = { value: '' };
  let click = null;
  const document = { getElementById: (id) => (id === 'captureLabEvidence' ? { addEventListener: (_e, fn) => { click = fn; } } : { textContent: ' x ' }) };
  new Function('document', 'notes', html.slice(start, end))(document, notes);
  click();
  return notes.value;
}

const EXPECTED = {
  'blade-studio.html': ['Verdict', 'Verdict note', 'Cp at operating point', 'Mean harvest', 'Harvest margin', 'Min store', 'Deepest charge', 'Engine mode'],
  'harvest-console.html': ['Verdict', 'Verdict note', 'Harvest margin', 'Min store', 'Deepest charge', 'Mean harvest', 'Worst gap', 'Model source'],
};

for (const [file, labels] of Object.entries(EXPECTED)) {
  test(`${file}: the analysis brief labels its lines in words, not element ids`, () => {
    const lines = brief(file).split('\n').filter((l) => / x$/.test(l));
    assert.deepEqual(lines, labels.map((l) => `${l}: x`));
  });
}
