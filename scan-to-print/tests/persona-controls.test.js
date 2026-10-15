/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 8: asked where the STL is, the concierge answered 'look for the option to view or download the STL/OBJ model' while the STL link was on screen. The served persona names the screen's controls, and each name it uses is one the served page renders (so a renamed control turns this red).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const persona = fs.readFileSync(path.join(PKG, 'personas', 'scan-to-print-operator.yaml'), 'utf8');
const html = fs.readFileSync(path.join(PKG, 'tools', 'scan-to-print.html'), 'utf8');
const js = fs.readFileSync(path.join(PKG, 'tools', 'scan-to-print.js'), 'utf8');

test('the persona names the download links, the viewer and the print step', () => {
  assert.match(persona, /## Where things are on the screen/);
  assert.match(persona, /\*\*STL\*\* \(the printable mesh\), \*\*OBJ\*\*/);
  assert.match(persona, /Tap\s+STL to download the model/);
  assert.match(persona, /\*\*Open in CAD Studio →\*\*/);
  assert.match(persona, /\*\*Send to printer…\*\*/);
});

test('every control the persona names is one the served page renders', () => {
  const kinds = (js.match(/\[('stl', 'obj', 'svg', 'report', 'gcode')\]\.forEach\(\(k\) => \{ if \(artifacts\[k\]\) links\.appendChild\(el\('a', \{[^}]*text: k\.toUpperCase\(\)/) || [])[1];
  assert.ok(kinds, 'the report renders its download links as the upper-cased artifact kinds');
  for (const label of ['STL', 'OBJ', 'SVG', 'REPORT', 'GCODE']) assert.ok(kinds.includes(`'${label.toLowerCase()}'`), label);
  assert.match(js, /text: 'Open in CAD Studio →'/);
  for (const heading of ['3 · Reconstruct', '4 · Print', '>3D model<', '>Send to printer…<']) assert.ok(html.includes(heading), heading);
});
