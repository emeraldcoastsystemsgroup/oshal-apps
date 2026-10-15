/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 13: "Use visible results" wrote the analysis brief handed to AI
 *   Office with HTML element ids as its labels ("runStatus: done in 6.0 s", "verdictCard: ...", "fingerprint: ...").
 *   The page's own click handler, run as shipped with a stub DOM, must label each line in words.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Run the page's "Use visible results" handler with a stub DOM; returns the brief it wrote. */
function brief(html, texts) {
  const start = html.indexOf('const tileText=');
  const end = html.indexOf(');});', start) + 5;
  assert.ok(start > 0 && end > start, 'the page has the capture handler');
  const notes = { value: '' };
  let click = null;
  const document = { getElementById: (id) => (id === 'captureLabEvidence' ? { addEventListener: (_e, fn) => { click = fn; } } : (id in texts ? { textContent: texts[id] } : null)) };
  new Function('document', 'notes', html.slice(start, end))(document, notes);
  click();
  return notes.value;
}

test('the analysis brief labels its lines in words, not element ids', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.html'), 'utf8');
  const out = brief(html, { verdictCard: 'closed ✓ admissible ✓', fingerprint: 'engine 1.2 · python 3.12\ncapabilities: polar✓', runStatus: 'done in 6.0 s' });
  assert.match(out, /^Verdict: closed ✓ admissible ✓$/m);
  assert.match(out, /^Engine: engine 1\.2 · python 3\.12 capabilities: polar✓$/m);
  assert.match(out, /^Run status: done in 6\.0 s$/m);
  assert.doesNotMatch(out, /verdictCard|fingerprint|runStatus/);
});
