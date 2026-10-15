/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The feature list reads a feature's parameters as words, not JSON. paramsText()
 *   and its helpers are executed out of the shipped tools/cad-studio.js: numbers, yes/no, vectors as "a × b × c", point
 *   lists counted, camelCase names as words, and renderFeatures() uses it instead of JSON.stringify(f.params).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'cad-studio.js'), 'utf8');
/** One function declaration cut out of the shipped script. */
function pick(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is never closed`);
}
const box = {};
vm.runInNewContext(`${pick('words')}\n${pick('valueText')}\n${pick('paramsText')}\nthis.paramsText = paramsText;`, box);

test('parameters read as words, never as JSON', () => {
  const text = box.paramsText({ diameter: 5, depth: 10.123456, through: true, center: [1, 2, 3], points: [[0, 0], [30, 0], [0, 30]], pathPlane: 'XY' });
  assert.equal(text, 'diameter 5 · depth 10.123 · through yes · center 1 × 2 × 3 · points 3 points · path plane XY');
  assert.ok(!/[{}"\[\]]/.test(text));
});

test('nested objects and empty parameters stay readable', () => {
  assert.equal(box.paramsText({ size: { x: 40, y: 20 } }), 'size x 40, y 20');
  assert.equal(box.paramsText({}), 'no parameters');
  assert.equal(box.paramsText(null), 'no parameters');
});

test('the feature list renders paramsText, not JSON.stringify(f.params)', () => {
  assert.ok(source.includes("el('div', { class: 'feature-params', text: paramsText(f.params) })"));
  assert.ok(!source.includes('JSON.stringify(f.params)'));
});
