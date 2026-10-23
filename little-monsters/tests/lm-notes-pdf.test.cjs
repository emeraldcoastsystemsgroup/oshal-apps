/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The lecture summary PDF (routes/education-notes-pdf.js): a well-formed PDF whose cross-reference offsets point at their objects, pages split when the notes are long, wrapped lines fit the page, PDF string delimiters are escaped and simple LaTeX is flattened.
 * -----------------------------------------------------------------------------
 *
 * Dependency-free (runs under the tests/*.test.cjs store-CI glob).
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { renderNotesPdf, notesLines } = require(path.join(__dirname, '..', 'routes', 'education-notes-pdf.js'));

const NOTES = [
  '# Biology: Photosynthesis',
  '## Overview',
  '* **Photosynthesis** turns light energy into chemical energy.',
  '* Inputs: carbon dioxide ($CO_2$) and water ($H_2O$)',
  '  * Nested (stroma) \\ detail',
  '1. Read chapter 4',
].join('\n');

test('the summary is a well-formed PDF whose xref offsets point at their objects', () => {
  const pdf = renderNotesPdf('Biology: Photosynthesis', NOTES).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  const xrefAt = Number(pdf.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(pdf.slice(xrefAt, xrefAt + 4), 'xref');
  const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((offset, i) => assert.equal(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(pdf, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count 1/);
});

test('notes become headings, bullets and plain text: emphasis removed, LaTeX flattened, delimiters escaped', () => {
  const lines = notesLines('Biology: Photosynthesis', NOTES);
  assert.deepEqual(lines.map((l) => l.style), ['title', 'h2', 'bullet', 'bullet', 'bullet', 'bullet']);
  assert.equal(lines[2].text, '- Photosynthesis turns light energy into chemical energy.');
  assert.equal(lines[3].text, '- Inputs: carbon dioxide (CO2) and water (H2O)');
  assert.ok(lines[4].indent > lines[3].indent, 'a nested bullet is indented further');
  assert.equal(lines[5].text, '1. Read chapter 4');
  const pdf = renderNotesPdf('T', NOTES).toString('latin1');
  assert.ok(pdf.includes('(- Nested \\(stroma\\) \\\\ detail) Tj'));
});

test('long notes wrap inside the margins and continue on further pages', () => {
  const long = Array.from({ length: 80 }, (_, i) => `* Point ${i} about chloroplasts, chlorophyll, the light-dependent reactions in the thylakoid membranes and the Calvin cycle in the stroma of the leaf cell.`).join('\n');
  const lines = notesLines('Long', long);
  assert.equal(lines.length, 1 + 80 * 2, 'every long bullet wraps onto exactly one continuation line');
  assert.ok(lines.filter((l) => !l.text.startsWith('- ') && l.style === 'bullet').every((l) => l.indent === 24), 'continuations hang under the bullet text');
  const pdf = renderNotesPdf('Long', long).toString('latin1');
  const count = Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/)[1]);
  assert.ok(count >= 3, `${count} pages`);
  assert.match(pdf, /\(Long - page 3 of \d+\) Tj/);
});
