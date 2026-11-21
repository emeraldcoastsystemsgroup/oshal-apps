/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | BACKLOG B4: self-contained binary STL mesh validator (exact
 *     |                                           | scan-to-print mesh-validate.ts edge census, winding, area,
 *     |                                           | positive volume, and Euler χ=2 checks), bundled OFL-1.1
 *     |                                           | font/license integrity check, and UI parameter-form checks
 *     |                                           | for `thread` and `text` features.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const RELATIVE_AREA_FLOOR = 1e-12;

/** @description Parse binary STL bytes into indexed vertices and triangles (exact coordinate identity). */
function parseBinaryStl(buf) {
  assert.ok(buf.length >= 84, 'STL must carry 80-byte header and 4-byte triangle count');
  const count = buf.readUInt32LE(80);
  assert.equal(buf.length, 84 + count * 50, 'STL byte length must match triangle count');
  const map = new Map();
  const vertices = [];
  const triangles = [];
  let offset = 84;
  for (let i = 0; i < count; i += 1) {
    offset += 12; // facet normal
    const tri = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      const x = buf.readFloatLE(offset);
      const y = buf.readFloatLE(offset + 4);
      const z = buf.readFloatLE(offset + 8);
      offset += 12;
      const key = `${x},${y},${z}`;
      let idx = map.get(key);
      if (idx === undefined) {
        idx = vertices.length;
        map.set(key, idx);
        vertices.push([x, y, z]);
      }
      tri[k] = idx;
    }
    offset += 2; // attribute byte count
    triangles.push(tri);
  }
  return { vertices, triangles };
}

function meshDiagonal(vertices) {
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (const [x, y, z] of vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

function censusMesh(vertices, triangles, areaEpsilon) {
  const census = new Map();
  const referenced = new Set();
  let degenerate = 0;
  let vol6 = 0;
  for (const [a, b, c] of triangles) {
    referenced.add(a); referenced.add(b); referenced.add(c);
    const va = vertices[a]; const vb = vertices[b]; const vc = vertices[c];
    const abx = vb[0] - va[0]; const aby = vb[1] - va[1]; const abz = vb[2] - va[2];
    const acx = vc[0] - va[0]; const acy = vc[1] - va[1]; const acz = vc[2] - va[2];
    if (0.5 * Math.hypot(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx) <= areaEpsilon) degenerate += 1;
    vol6 += va[0] * (vb[1] * vc[2] - vb[2] * vc[1]) + va[1] * (vb[2] * vc[0] - vb[0] * vc[2]) + va[2] * (vb[0] * vc[1] - vb[1] * vc[0]);
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const use = census.get(key) || { count: 0, forward: 0 };
      use.count += 1;
      if (from <= to) use.forward += 1;
      census.set(key, use);
    }
  }
  return { census, referenced, degenerate, volumeMm3: vol6 / 6 };
}

/** @description Exact mirror of scan-to-print/src-routes/engine/geometry/mesh-validate.ts. */
function validateBinaryStl(buf) {
  const { vertices, triangles } = parseBinaryStl(buf);
  const diag = meshDiagonal(vertices);
  const { census, referenced, degenerate, volumeMm3 } = censusMesh(vertices, triangles, diag * diag * RELATIVE_AREA_FLOOR);
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let consistentWinding = triangles.length > 0;
  for (const use of census.values()) {
    if (use.count === 1) boundaryEdges += 1;
    else if (use.count > 2) nonManifoldEdges += 1;
    if (use.count === 2 && use.forward !== 1) consistentWinding = false;
  }
  const openEdges = boundaryEdges + nonManifoldEdges;
  const watertight = triangles.length > 0 && openEdges === 0;
  const eulerCharacteristic = referenced.size - census.size + triangles.length;
  const outwardFacing = watertight && consistentWinding && volumeMm3 > 0;
  return {
    watertight, openEdges, boundaryEdges, nonManifoldEdges, consistentWinding, outwardFacing,
    degenerate, eulerCharacteristic, volumeMm3, triangles: triangles.length,
    valid: watertight && consistentWinding && outwardFacing && degenerate === 0 && eulerCharacteristic === 2,
  };
}

/** @description Encode indexed triangles as a binary STL buffer for validator unit checks. */
function encodeBinaryStl(vertices, triangles) {
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.write('cad-studio b4 validator test', 0, 'ascii');
  buf.writeUInt32LE(triangles.length, 80);
  let off = 84;
  for (const [a, b, c] of triangles) {
    off += 12;
    for (const idx of [a, b, c]) {
      buf.writeFloatLE(vertices[idx][0], off);
      buf.writeFloatLE(vertices[idx][1], off + 4);
      buf.writeFloatLE(vertices[idx][2], off + 8);
      off += 12;
    }
    off += 2;
  }
  return buf;
}

const TETRA_VERTS = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]];
const TETRA_TRIS = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];

test('binary STL mesh validator accepts a closed outward manifold solid and rejects open, inverted, or degenerate meshes', () => {
  const ok = validateBinaryStl(encodeBinaryStl(TETRA_VERTS, TETRA_TRIS));
  assert.equal(ok.valid, true);
  assert.equal(ok.watertight, true);
  assert.equal(ok.boundaryEdges, 0);
  assert.equal(ok.nonManifoldEdges, 0);
  assert.equal(ok.consistentWinding, true);
  assert.equal(ok.outwardFacing, true);
  assert.equal(ok.degenerate, 0);
  assert.equal(ok.eulerCharacteristic, 2);
  assert.ok(Math.abs(ok.volumeMm3 - 1000 / 6) < 0.01);

  const open = validateBinaryStl(encodeBinaryStl(TETRA_VERTS, TETRA_TRIS.slice(0, 3)));
  assert.equal(open.valid, false);
  assert.equal(open.watertight, false);
  assert.equal(open.boundaryEdges, 3);

  const inverted = validateBinaryStl(encodeBinaryStl(TETRA_VERTS, TETRA_TRIS.map(([a, b, c]) => [a, c, b])));
  assert.equal(inverted.valid, false);
  assert.equal(inverted.outwardFacing, false);
  assert.ok(inverted.volumeMm3 < 0);

  const badWind = validateBinaryStl(encodeBinaryStl(TETRA_VERTS, [[0, 1, 2], ...TETRA_TRIS.slice(1)]));
  assert.equal(badWind.valid, false);
  assert.equal(badWind.consistentWinding, false);
});

test('bundled LiberationSans-Regular.ttf font and SIL OFL 1.1 LICENSE ship in engine/fonts/', () => {
  const fontPath = path.join(PKG_DIR, 'engine', 'fonts', 'LiberationSans-Regular.ttf');
  const licensePath = path.join(PKG_DIR, 'engine', 'fonts', 'LICENSE.txt');
  assert.ok(fs.existsSync(fontPath), 'engine/fonts/LiberationSans-Regular.ttf must exist');
  assert.ok(fs.existsSync(licensePath), 'engine/fonts/LICENSE.txt must exist');
  const fontBytes = fs.readFileSync(fontPath);
  assert.ok(fontBytes.length > 50_000, 'font must be a real TrueType file');
  assert.deepEqual([...fontBytes.subarray(0, 4)], [0x00, 0x01, 0x00, 0x00], 'TrueType SFNT header');
  const licenseText = fs.readFileSync(licensePath, 'utf8');
  assert.match(licenseText, /SIL OPEN FONT LICENSE|OFL/i);
});

test('cad-studio.js parameter form handles thread selects and text string/emboss/deboss/face inputs', () => {
  const js = fs.readFileSync(path.join(PKG_DIR, 'tools', 'cad-studio.js'), 'utf8');
  assert.match(js, /STRING_PARAMS = new Set\(\['text'\]\)/);
  assert.match(js, /kind:\s*\['external',\s*'internal'\]/);
  assert.match(js, /handedness:\s*\['right',\s*'left'\]/);
  assert.match(js, /face:\s*\['top',\s*'bottom',\s*'front',\s*'back',\s*'left',\s*'right'\]/);
  assert.match(js, /type === 'text'\s*\?\s*\['emboss',\s*'deboss'\]\s*:\s*\['add',\s*'cut'\]/);
  assert.match(js, /if \(node\.getAttribute\('data-string'\)\) \{ params\[name\] = raw; return; \}/);
});

module.exports = { parseBinaryStl, validateBinaryStl };
