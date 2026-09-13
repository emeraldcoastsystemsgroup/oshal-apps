/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The vendored geometry primitives: exact binary STL length, ASCII STL and OBJ text shapes (1-based OBJ indices), the validator's four independent verdicts on a closed tetrahedron, an open one and an inverted one, and the pure-engine guarantee (no framework require anywhere under routes/engine).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE_DIR = path.resolve(__dirname, '..', 'routes', 'engine');
const e = require(path.join(ENGINE_DIR, 'index.js'));

/** A unit tetrahedron wound outward. */
function tetrahedron() {
  return {
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
  };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

test('the compiled engine reaches for no framework module and no bare dependency', () => {
  const files = walk(ENGINE_DIR).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 18, `expected the full engine, found ${files.length} files`);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const id of requires) assert.ok(id.startsWith('.'), `${path.relative(ENGINE_DIR, file)} requires "${id}" — the engine must be pure`);
  }
});

test('binary STL is exactly 84 + 50·n bytes, little-endian, and never starts with "solid"', () => {
  const mesh = tetrahedron();
  const bytes = e.toStlBinary(mesh);
  assert.equal(bytes.length, e.stlBinaryByteLength(4));
  assert.equal(bytes.length, 84 + 50 * 4);
  assert.notEqual(Buffer.from(bytes.subarray(0, 5)).toString('ascii'), 'solid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(80, true), 4);
  const normalX = view.getFloat32(84, true);
  assert.ok(Number.isFinite(normalX));
});

test('ASCII STL and OBJ carry every facet; OBJ indices are 1-based', () => {
  const mesh = tetrahedron();
  const ascii = e.toStlAscii(mesh, 'my part');
  assert.ok(ascii.startsWith('solid my_part\n'));
  assert.equal((ascii.match(/facet normal/g) || []).length, 4);
  assert.ok(ascii.endsWith('endsolid my_part\n'));
  const obj = e.toObj(mesh, 'my part');
  const faces = obj.split('\n').filter((l) => l.startsWith('f '));
  assert.equal(faces.length, 4);
  const indices = faces.flatMap((l) => l.slice(2).split(' ').map((t) => Number(t.split('//')[0])));
  assert.equal(Math.min(...indices), 1);
  assert.equal(Math.max(...indices), 4);
});

test('validateMesh: closed outward tetrahedron is valid with χ = 2 and positive volume', () => {
  const v = e.validateMesh(tetrahedron());
  assert.equal(v.valid, true);
  assert.equal(v.watertight, true);
  assert.equal(v.eulerCharacteristic, 2);
  assert.equal(v.outwardFacing, true);
  assert.ok(Math.abs(e.meshVolume(tetrahedron()) - 1 / 6) < 1e-12);
});

test('validateMesh: a missing facet is a boundary; an inverted solid is not outward-facing', () => {
  const open = tetrahedron();
  open.triangles.pop();
  const v = e.validateMesh(open);
  assert.equal(v.watertight, false);
  assert.equal(v.boundaryEdges, 3);
  const inverted = e.flipWinding(tetrahedron());
  const w = e.validateMesh(inverted);
  assert.equal(w.watertight, true);
  assert.equal(w.outwardFacing, false);
  assert.equal(w.valid, false);
});

test('meshBounds refuses an empty mesh and measures a box', () => {
  assert.throws(() => e.meshBounds({ vertices: [], triangles: [] }), RangeError);
  const b = e.meshBounds({ vertices: [{ x: -1, y: -2, z: 0 }, { x: 1, y: 2, z: 5 }], triangles: [] });
  assert.deepEqual(b.size, { x: 2, y: 4, z: 5 });
  assert.deepEqual(b.center, { x: 0, y: 0, z: 2.5 });
});

test('formatFloat never emits exponents or -0', () => {
  assert.equal(e.formatFloat(-0), '0');
  assert.equal(e.formatFloat(1e-7), '0.0000001');
  assert.equal(e.formatFloat(12.5, 1), '12.5');
  assert.throws(() => e.formatFloat(NaN), RangeError);
});
