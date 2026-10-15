/**
 * Guards for how the starter examples are named to a person.
 *
 * Sweep 13 (2026-10-13, phone 412x915): asked what to do on an empty lab, the concierge said 'Use the dropdown
 * labeled "unlabelled list under engine: idle"' and listed the examples by id (led-switch, rc-charge, ...). The
 * dropdown had no label, and the create tool's description listed ids only. The dropdown now carries a visible
 * Examples label, and the tool pairs every example id the routes serve with the title the list shows.
 *
 * Real: the compiled examples module the routes serve, the shipped page, manifest and persona. Nothing is doubled.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Examples label names the dropdown; circuit-create-design pairs each served example id with its title and says to name an example by its title; the persona says the same.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listExamples } = require('../routes/examples.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the examples dropdown has a visible label', () => {
  const html = read('tools/circuit-lab.html');
  const label = /<label\b[^>]*\bfor="example-select"[^>]*>([^<]+)<\/label>/.exec(html);
  assert.ok(label, 'a <label for="example-select"> names the dropdown');
  assert.equal(label[1].trim(), 'Examples');
  assert.match(html, /<select id="example-select">/);
});

test('the create tool pairs every served example id with the title the list shows', () => {
  const manifest = read('oshal-app.yaml');
  const block = manifest.slice(manifest.indexOf('  - name: circuit-create-design'), manifest.indexOf('\n  - name: ', manifest.indexOf('  - name: circuit-create-design') + 5));
  const examples = listExamples();
  assert.ok(examples.length >= 6);
  for (const e of examples) assert.ok(block.includes(`${e.id} (${e.title})`), `${e.id} is paired with "${e.title}"`);
  assert.match(block, /Name an example to the person by its title, the words in the Examples list/);
  assert.match(read('personas/circuit-lab-engineer.yaml'), /Name a starter example by its title, the words in the Examples list on screen/);
});
