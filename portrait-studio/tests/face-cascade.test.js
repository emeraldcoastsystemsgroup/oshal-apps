/* CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify pinned model integrity, input limits and genuine no-face behavior without providers.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { detect } = require('../tools/portrait-face-cascade');
const model = JSON.parse(readFileSync(join(__dirname, '../tools/face-model/facefinder.json'), 'utf8'));

test('lossless model re-encodes to the exact pinned upstream binary hash', () => {
  const binary = Buffer.alloc(239632); let offset = 0;
  Buffer.from(model.header).copy(binary); offset += 8;
  binary.writeInt32LE(model.depth, offset); offset += 4;
  binary.writeInt32LE(model.count, offset); offset += 4;
  for (const tree of model.trees) {
    for (const code of tree.codes) binary.writeInt8(code, offset++);
    for (const leaf of tree.leaves) { binary.writeFloatLE(leaf, offset); offset += 4; }
    binary.writeFloatLE(tree.threshold, offset); offset += 4;
  }
  assert.equal(offset, binary.length);
  assert.equal(createHash('sha256').update(binary).digest('hex'), 'd8014993e7298c7b1865d1f8b855d6dbf4ec5c808bf879e2091ab6837abf90cd');
});

test('the real cascade does not invent faces in uniform dark or bright images', () => {
  for (const value of [0, 128, 255]) assert.deepEqual(detect(new Uint8Array(128 * 128).fill(value), 128, 128, model, 6), []);
});

test('oversized, truncated, invalid and unbounded image inputs are refused before scanning', () => {
  for (const [pixels, width, height, max] of [
    [new Uint8Array(24 * 24), 24, 24, 0], [new Uint8Array(24 * 24), 24, 24, 7],
    [new Uint8Array(24 * 24), 641, 24, 6], [new Uint8Array(24 * 24), 23, 24, 6],
    [new Uint8Array(23), 24, 24, 6], [[], 24, 24, 6], [new Uint8Array(24 * 24), NaN, 24, 6],
  ]) assert.throws(() => detect(pixels, width, height, model, max), /Invalid face image/);
});

test('malformed cascade data cannot enter the typed classifier', () => {
  for (const changed of [{ ...model, depth: 7 }, { ...model, trees: [] },
    { ...model, trees: [{ ...model.trees[0], threshold: NaN }, ...model.trees.slice(1)] },
    { ...model, trees: [{ ...model.trees[0], codes: Array(252).fill(999) }, ...model.trees.slice(1)] }]) {
    assert.throws(() => detect(new Uint8Array(24 * 24), 24, 24, changed, 1), /Invalid face (model|tree)/);
  }
});
