/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | ADR-203 D7, lane @ds-fab: STL bytes the print-set suites share - a binary box of twelve triangles (watertight: every edge on exactly two triangles), the same box with one triangle dropped (three open edges), an ASCII box, and the kernel report CAD Studio writes for a box of those sizes (valid, volume, mass at a density, extents) so a fake CAD Studio answers in the real shape. Nothing here touches an engine.
 */
'use strict';

/** The twelve triangles of a box with corners at (0,0,0) and (x,y,z), outward wound. */
function boxTriangles(x, y, z) {
  const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return faces.flatMap(([a, b, c, d]) => [[v[a], v[b], v[c]], [v[a], v[c], v[d]]]);
}

/** @description Binary STL bytes for a list of triangles (vertex triples). */
function binaryStl(triangles) {
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.write('design-studio fixture', 0, 'latin1');
  buf.writeUInt32LE(triangles.length, 80);
  triangles.forEach((t, i) => { const o = 84 + i * 50 + 12; t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, o + k * 12 + j * 4))); });
  return buf;
}

/** @description ASCII STL text for a list of triangles. */
function asciiStl(triangles, name = 'fixture') {
  const facet = (t) => `  facet normal 0 0 0\n    outer loop\n${t.map((p) => `      vertex ${p.join(' ')}`).join('\n')}\n    endloop\n  endfacet`;
  return Buffer.from(`solid ${name}\n${triangles.map(facet).join('\n')}\nendsolid ${name}\n`);
}

/** @description A watertight binary box. */
function boxStl(x = 20, y = 20, z = 10) { return binaryStl(boxTriangles(x, y, z)); }
/** @description The same box with one triangle missing: three open edges, not watertight. */
function openStl(x = 20, y = 20, z = 10) { return binaryStl(boxTriangles(x, y, z).slice(1)); }
/** @description The box as ASCII. */
function asciiBoxStl(x = 20, y = 20, z = 10) { return asciiStl(boxTriangles(x, y, z)); }

/** @description CAD Studio's kernel report for a box (the fields report_for writes), at a density. */
function boxReport(x = 20, y = 20, z = 10, densityGcm3 = 1.24) {
  const volume = x * y * z;
  return { extentsMm: { min: [-x / 2, -y / 2, 0], max: [x / 2, y / 2, z] }, volumeMm3: volume, surfaceAreaMm2: 2 * (x * y + y * z + x * z), massG: Math.round(volume / 1000 * densityGcm3 * 1000) / 1000, densityGcm3, centerOfMassMm: [0, 0, z / 2], faces: 6, edges: 12, vertices: 8, valid: true };
}

module.exports = { boxTriangles, binaryStl, asciiStl, boxStl, openStl, asciiBoxStl, boxReport };
