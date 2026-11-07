/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.5.0: unit and route proofs for Wavefront OBJ + MTL and Open Packaging Conventions 3MF exports (RP-CAD-03) plus binary glTF 2.0 (.glb) and uncompressed 64-byte-aligned Apple USDZ AR mesh exports (RP-CAD-04).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fromStl,
  toObj,
  toMtl,
  parseObj,
  to3mf,
  parse3mf,
  toGlb,
  parseGlb,
  toUsdz,
  parseUsdz,
} = require('../routes/mesh-formats.js');

const BOX_VERTS = [
  [-30, -20, 0], [30, -20, 0], [30, 20, 0], [-30, 20, 0],
  [-30, -20, 30], [30, -20, 30], [30, 20, 30], [-30, 20, 30],
];
const BOX_FACES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];

function makeBinaryBoxStl() {
  const buf = Buffer.alloc(84 + BOX_FACES.length * 50);
  buf.write('oshal-cad-studio-box', 0, 'ascii');
  buf.writeUInt32LE(BOX_FACES.length, 80);
  BOX_FACES.forEach((f, idx) => {
    const [a, b, c] = f.map((i) => BOX_VERTS[i]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const vals = [nx / len, ny / len, nz / len, ...a, ...b, ...c];
    vals.forEach((v, k) => buf.writeFloatLE(v, 84 + idx * 50 + k * 4));
  });
  return new Uint8Array(buf);
}

function makeAsciiBoxStl() {
  const lines = ['solid cad_box'];
  for (const f of BOX_FACES) {
    const [a, b, c] = f.map((i) => BOX_VERTS[i]);
    lines.push('  facet normal 0 0 1', '    outer loop');
    lines.push(`      vertex ${a.join(' ')}`, `      vertex ${b.join(' ')}`, `      vertex ${c.join(' ')}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid cad_box');
  return new TextEncoder().encode(lines.join('\n'));
}

function extentsOf(mesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) {
    lo[0] = Math.min(lo[0], v.x); lo[1] = Math.min(lo[1], v.y); lo[2] = Math.min(lo[2], v.z);
    hi[0] = Math.max(hi[0], v.x); hi[1] = Math.max(hi[1], v.y); hi[2] = Math.max(hi[2], v.z);
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

test('fromStl welds binary and ASCII STL into an indexed 8-vertex, 12-triangle solid', () => {
  const binMesh = fromStl(makeBinaryBoxStl());
  const ascMesh = fromStl(makeAsciiBoxStl());
  assert.equal(binMesh.vertices.length, 8);
  assert.equal(binMesh.triangles.length, 12);
  assert.equal(ascMesh.vertices.length, 8);
  assert.equal(ascMesh.triangles.length, 12);
  assert.deepEqual(extentsOf(binMesh), [60, 40, 30]);
  assert.deepEqual(extentsOf(ascMesh), [60, 40, 30]);
});

test('RP-CAD-03: Wavefront OBJ + MTL export round-trips vertices, unit normals, mtllib, and 1-based faces', () => {
  const mesh = fromStl(makeBinaryBoxStl());
  const objText = toObj(mesh, 'Mount Bracket #2', 'Mount_Bracket_2-r1.mtl');
  const mtlText = toMtl('cad_part_mat');
  assert.match(objText, /^mtllib Mount_Bracket_2-r1\.mtl$/m);
  assert.match(objText, /^o Mount_Bracket_2$/m);
  assert.match(objText, /^usemtl cad_part_mat$/m);
  assert.match(objText, /^f 1\/\/1 2\/\/1 3\/\/1$/m);
  assert.match(mtlText, /^newmtl cad_part_mat$/m);
  assert.match(mtlText, /^Kd 0\.620000 0\.680000 0\.780000$/m);
  const parsed = parseObj(objText);
  assert.equal(parsed.vertices.length, 8);
  assert.equal(parsed.triangles.length, 12);
  assert.deepEqual(extentsOf(parsed), [60, 40, 30]);
});

test('RP-CAD-03: 3MF export produces a valid OPC ZIP with [Content_Types].xml, _rels/.rels, and 3D/3dmodel.model', () => {
  const mesh = fromStl(makeBinaryBoxStl());
  const archive = to3mf(mesh, 'Bracket <Rev 1> & Bolts');
  const headerMagic = Buffer.from(archive.buffer, archive.byteOffset, 4).readUInt32LE(0);
  assert.equal(headerMagic, 0x04034b50, 'PK\\x03\\x04 ZIP local header');
  const parsed = parse3mf(archive);
  assert.deepEqual(parsed.files, ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
  assert.equal(parsed.unit, 'millimeter');
  assert.equal(parsed.title, 'Bracket &lt;Rev 1&gt; &amp; Bolts');
  assert.equal(parsed.mesh.vertices.length, 8);
  assert.equal(parsed.mesh.triangles.length, 12);
  assert.deepEqual(extentsOf(parsed.mesh), [60, 40, 30]);
});

test('RP-CAD-04: GLB binary glTF 2.0 and uncompressed 64-byte-aligned USDZ round-trip true-scale CAD geometry', () => {
  const mesh = fromStl(makeBinaryBoxStl());
  const glb = toGlb(mesh, 'Bracket');
  const parsedGlb = parseGlb(glb);
  assert.equal(parsedGlb.magic, 0x46546c67);
  assert.equal(parsedGlb.version, 2);
  assert.equal(parsedGlb.json.asset.version, '2.0');
  assert.equal(parsedGlb.mesh.vertices.length, 8);
  assert.equal(parsedGlb.mesh.triangles.length, 12);
  const glbExtents = extentsOf(parsedGlb.mesh);
  assert.ok(Math.abs(glbExtents[0] - 60) < 1e-3 && Math.abs(glbExtents[1] - 40) < 1e-3 && Math.abs(glbExtents[2] - 30) < 1e-3);

  const usdz = toUsdz(mesh, 'Bracket');
  const parsedUsdz = parseUsdz(usdz);
  assert.equal(parsedUsdz.entries.length, 1);
  assert.equal(parsedUsdz.entries[0].name, 'model.usda');
  assert.equal(parsedUsdz.entries[0].compressionMethod, 0, 'USDZ entries must use store/zero compression');
  assert.equal(parsedUsdz.entries[0].dataOffset % 64, 0, 'USDZ payload must be 64-byte aligned');
  assert.match(parsedUsdz.usda, /metersPerUnit = 0\.001/);
  assert.match(parsedUsdz.usda, /upAxis = "Z"/);
  assert.equal(parsedUsdz.mesh.vertices.length, 8);
  assert.equal(parsedUsdz.mesh.triangles.length, 12);
  assert.deepEqual(extentsOf(parsedUsdz.mesh), [60, 40, 30]);
});
