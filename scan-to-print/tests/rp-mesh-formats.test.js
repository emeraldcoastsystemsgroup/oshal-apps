/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.10.0: unit proofs for STL parsing, 3D bounding-box crop (RP-SCN-01), lay-flat & rotation leveling to Z=0 (RP-SCN-02), surface raycast & point-to-point distance measurement (RP-SCN-03), and binary GLB 2.0 + uncompressed 64-byte-aligned USDZ export round-trips (RP-SCN-04).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toStlBinary,
  toStlAscii,
  fromStl,
  toGlb,
  parseGlb,
  toUsdz,
  parseUsdz,
  cropMesh,
  transformMesh,
  raycastMesh,
  measurePoints,
  meshBounds,
  meshVolume,
  validateMesh,
} = require('../routes/engine/index.js');

function makeBoxMesh(minX, maxX, minY, maxY, minZ, maxZ) {
  const vertices = [
    { x: minX, y: minY, z: minZ },
    { x: maxX, y: minY, z: minZ },
    { x: maxX, y: maxY, z: minZ },
    { x: minX, y: maxY, z: minZ },
    { x: minX, y: minY, z: maxZ },
    { x: maxX, y: minY, z: maxZ },
    { x: maxX, y: maxY, z: maxZ },
    { x: minX, y: maxY, z: maxZ },
  ];
  const triangles = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [2, 3, 7], [2, 7, 6],
    [0, 4, 7], [0, 7, 3],
    [1, 2, 6], [1, 6, 5],
  ];
  return { vertices, triangles };
}

test('fromStl parses both binary and ASCII STL into welded indexed meshes', () => {
  const box = makeBoxMesh(-20, 20, -15, 15, 0, 30);
  const fromBin = fromStl(toStlBinary(box));
  assert.equal(fromBin.vertices.length, 8);
  assert.equal(fromBin.triangles.length, 12);
  assert.ok(Math.abs(meshVolume(fromBin) - 40 * 30 * 30) < 1e-3);

  const fromTxt = fromStl(Buffer.from(toStlAscii(box, 'box'), 'utf8'));
  assert.equal(fromTxt.vertices.length, 8);
  assert.equal(fromTxt.triangles.length, 12);
});

test('RP-SCN-04: toGlb writes valid glTF 2.0 binary magic 0x46546C67 and round-trips geometry', () => {
  const box = makeBoxMesh(-30, 30, -20, 20, 0, 25);
  const glb = toGlb(box, { name: 'Bracket' });
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'magic is glTF (0x46546C67)');
  assert.equal(view.getUint32(4, true), 2, 'glTF container version 2');
  assert.equal(view.getUint32(8, true), glb.byteLength, 'header length matches byteLength');
  assert.equal(glb.byteLength % 4, 0, '4-byte aligned container');

  const parsed = parseGlb(glb);
  assert.equal(parsed.json.asset.version, '2.0');
  assert.deepEqual(parsed.json.nodes[0].scale, [0.001, 0.001, 0.001], 'millimetre-to-metre scale node');
  assert.equal(parsed.mesh.vertices.length, 8);
  assert.equal(parsed.mesh.triangles.length, 12);
  const b = meshBounds(parsed.mesh);
  assert.ok(Math.abs(b.max.x - b.min.x - 60) < 1e-4);
  assert.ok(Math.abs(b.max.y - b.min.y - 40) < 1e-4);
  assert.ok(Math.abs(b.max.z - b.min.z - 25) < 1e-4);
});

test('RP-SCN-04: toUsdz writes uncompressed zero-compression 64-byte-aligned ZIP with .usda and round-trips geometry', () => {
  const box = makeBoxMesh(-10, 10, -15, 15, 0, 40);
  const usdz = toUsdz(box, 'ScanPart');
  const view = new DataView(usdz.buffer, usdz.byteOffset, usdz.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50, 'ZIP local file header PK\\x03\\x04');
  assert.equal(view.getUint16(8, true), 0, 'compression method 0 (uncompressed stored)');

  const parsed = parseUsdz(usdz);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].name, 'model.usda');
  assert.equal(parsed.entries[0].dataOffset % 64, 0, 'payload starts on a 64-byte boundary per Apple USDZ spec');
  assert.match(parsed.usda, /metersPerUnit = 0\.001/);
  assert.match(parsed.usda, /upAxis = "Z"/);
  assert.equal(parsed.mesh.vertices.length, 8);
  assert.equal(parsed.mesh.triangles.length, 12);
  const b = meshBounds(parsed.mesh);
  assert.ok(Math.abs(b.max.z - b.min.z - 40) < 1e-4);
});

test('RP-SCN-01: cropMesh clips triangles cleanly, caps cut planes watertight, and snaps cropped base to Z=0', () => {
  const box = makeBoxMesh(-30, 30, -20, 20, 0, 40);
  const cropped = cropMesh(box, { minX: -10, maxX: 30, minY: -15, maxY: 20, minZ: 10, maxZ: 40 }, true);
  const b = meshBounds(cropped);
  assert.ok(Math.abs(b.min.x - -10) < 1e-4 && Math.abs(b.max.x - 30) < 1e-4);
  assert.ok(Math.abs(b.min.y - -15) < 1e-4 && Math.abs(b.max.y - 20) < 1e-4);
  assert.ok(Math.abs(b.min.z - 0) < 1e-4, 'cropped base snapped to build plate Z = 0');
  assert.ok(Math.abs(b.max.z - 30) < 1e-4, 'height preserved as 40 - 10 = 30 mm');
  const val = validateMesh(cropped);
  assert.equal(val.watertight, true, 'planar cut caps keep cropped solid watertight');
  assert.equal(val.openEdges, 0);
  assert.ok(Math.abs(meshVolume(cropped) - 40 * 35 * 30) < 1e-2, 'exact clipped box volume 42,000 mm³');
  assert.throws(() => cropMesh(box, { minX: 100, maxX: 120, minY: 0, maxY: 10, minZ: 0, maxZ: 10 }), RangeError);
});

test('RP-SCN-02: transformMesh levels tilted geometry onto Z=0 and applies exact axis rotations', () => {
  const tallPlate = makeBoxMesh(-40, 40, -5, 5, 12, 72); // largest faces point along ±Y (80 x 60 = 4800 mm²)
  const tilted = transformMesh(tallPlate, { rxDeg: 23, snapToBed: false });
  const leveled = transformMesh(tilted, { layFlat: 'auto', snapToBed: true });
  const b = meshBounds(leveled);
  assert.ok(Math.abs(b.min.z) < 1e-4, 'snapped to Z = 0');
  assert.ok(b.max.z < 12, `dominant face laid flat so height became thickness ~10 mm (got ${b.max.z})`);
});

test('RP-SCN-03: raycastMesh and measurePoints return exact millimetre surface distances and deltas', () => {
  const box = makeBoxMesh(-20, 20, -15, 15, 0, 30);
  const hitA = raycastMesh(box, { x: -10, y: 0, z: 100 }, { x: 0, y: 0, z: -1 });
  const hitB = raycastMesh(box, { x: 14, y: 7, z: 100 }, { x: 0, y: 0, z: -1 });
  assert.ok(hitA && hitB, 'both rays hit top face z = 30');
  assert.ok(Math.abs(hitA.point.z - 30) < 1e-6);
  const m = measurePoints(hitA.point, hitB.point);
  assert.equal(m.absDeltaMm.x, 24);
  assert.equal(m.absDeltaMm.y, 7);
  assert.equal(m.absDeltaMm.z, 0);
  assert.equal(m.distanceMm, 25); // 7-24-25 right triangle
});
