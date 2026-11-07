/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Apple USDZ uncompressed 64-byte-aligned ZIP writer and round-trip reader containing a Z-up millimetre USDA mesh and UsdPreviewSurface material (RP-SCN-04).
 */

import type { Triangle, TriMesh, Vec3 } from './geometry-types';
import { formatFloat } from './format-number';
import { meshBounds } from './mesh-metrics';
import { crossVec, resolveTriangle } from './vector-math';

const ZIP_LOCAL_MAGIC = 0x04034b50;
const ZIP_CENTRAL_MAGIC = 0x02014b50;
const ZIP_EOCD_MAGIC = 0x06054b50;
const USDZ_ALIGNMENT = 64;
const USDZ_EXTRA_HEADER_ID = 0x1986;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function vertexNormals(mesh: TriMesh): Vec3[] {
  const accum: Vec3[] = mesh.vertices.map(() => ({ x: 0, y: 0, z: 0 }));
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const [i0, i1, i2] = mesh.triangles[i];
    const [a, b, c] = resolveTriangle(mesh, mesh.triangles[i], i);
    const w = crossVec({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z });
    for (const idx of [i0, i1, i2]) {
      accum[idx].x += w.x;
      accum[idx].y += w.y;
      accum[idx].z += w.z;
    }
  }
  return accum.map((n) => {
    const len = Math.hypot(n.x, n.y, n.z);
    return len > 1e-12 ? { x: n.x / len, y: n.y / len, z: n.z / len } : { x: 0, y: 0, z: 1 };
  });
}

const USDA_MATERIAL_BLOCK = [
  '    def Material "Material"',
  '    {',
  '        token outputs:surface.connect = </Root/Material/PBRShader.outputs:surface>',
  '',
  '        def Shader "PBRShader"',
  '        {',
  '            uniform token info:id = "UsdPreviewSurface"',
  '            color3f inputs:diffuseColor = (0.82, 0.85, 0.89)',
  '            float inputs:metallic = 0.08',
  '            float inputs:roughness = 0.55',
  '            token outputs:surface',
  '        }',
  '    }',
];

/**
 * @description Build the ASCII USD (`.usda`) scene text for a millimetre Z-up {@link TriMesh}.
 */
export function toUsda(mesh: TriMesh, name = 'Part'): string {
  if (mesh.vertices.length === 0 || mesh.triangles.length === 0) {
    throw new RangeError('USDZ export requires a non-empty mesh');
  }
  const primName = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1') || 'Part';
  const bounds = meshBounds(mesh);
  const normals = vertexNormals(mesh);
  const counts = new Array(mesh.triangles.length).fill('3').join(', ');
  const indices = mesh.triangles.map(([a, b, c]) => `${a}, ${b}, ${c}`).join(', ');
  const points = mesh.vertices.map((v) => `(${formatFloat(v.x)}, ${formatFloat(v.y)}, ${formatFloat(v.z)})`).join(', ');
  const normText = normals.map((n) => `(${formatFloat(n.x)}, ${formatFloat(n.y)}, ${formatFloat(n.z)})`).join(', ');
  const extMin = `(${formatFloat(bounds.min.x)}, ${formatFloat(bounds.min.y)}, ${formatFloat(bounds.min.z)})`;
  const extMax = `(${formatFloat(bounds.max.x)}, ${formatFloat(bounds.max.y)}, ${formatFloat(bounds.max.z)})`;
  return [
    '#usda 1.0',
    '(',
    '    defaultPrim = "Root"',
    '    metersPerUnit = 0.001',
    '    upAxis = "Z"',
    ')',
    '',
    'def Xform "Root"',
    '{',
    `    def Mesh "${primName}" (`,
    '        prepend apiSchemas = ["MaterialBindingAPI"]',
    '    )',
    '    {',
    `        float3[] extent = [${extMin}, ${extMax}]`,
    `        int[] faceVertexCounts = [${counts}]`,
    `        int[] faceVertexIndices = [${indices}]`,
    '        rel material:binding = </Root/Material>',
    `        normal3f[] normals = [${normText}] (`,
    '            interpolation = "vertex"',
    '        )',
    `        point3f[] points = [${points}]`,
    '        uniform token subdivisionScheme = "none"',
    '    }',
    '',
    ...USDA_MATERIAL_BLOCK,
    '}',
    '',
  ].join('\n');
}

function alignmentExtraField(currentOffset: number, nameLength: number): Uint8Array {
  const unaligned = (currentOffset + 30 + nameLength) % USDZ_ALIGNMENT;
  if (unaligned === 0) return new Uint8Array(0);
  let pad = USDZ_ALIGNMENT - unaligned;
  if (pad < 4) pad += USDZ_ALIGNMENT;
  const extra = new Uint8Array(pad);
  const view = new DataView(extra.buffer);
  view.setUint16(0, USDZ_EXTRA_HEADER_ID, true);
  view.setUint16(2, pad - 4, true);
  return extra;
}

function buildZipEntryHeaders(
  nameBytes: Uint8Array,
  dataLen: number,
  sum: number,
  offset: number,
): { localHeader: Uint8Array; central: Uint8Array } {
  const extra = alignmentExtraField(offset, nameBytes.byteLength);
  const localHeader = new Uint8Array(30 + nameBytes.byteLength + extra.byteLength);
  const lv = new DataView(localHeader.buffer);
  lv.setUint32(0, ZIP_LOCAL_MAGIC, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(12, 0x21, true);
  lv.setUint32(14, sum, true);
  lv.setUint32(18, dataLen, true);
  lv.setUint32(22, dataLen, true);
  lv.setUint16(26, nameBytes.byteLength, true);
  lv.setUint16(28, extra.byteLength, true);
  localHeader.set(nameBytes, 30);
  localHeader.set(extra, 30 + nameBytes.byteLength);

  const central = new Uint8Array(46 + nameBytes.byteLength);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, ZIP_CENTRAL_MAGIC, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(14, 0x21, true);
  cv.setUint32(16, sum, true);
  cv.setUint32(20, dataLen, true);
  cv.setUint32(24, dataLen, true);
  cv.setUint16(28, nameBytes.byteLength, true);
  cv.setUint32(42, offset, true);
  central.set(nameBytes, 46);
  return { localHeader, central };
}

/**
 * @description Pack uncompressed entries into a 64-byte-aligned USDZ archive per Apple's USDZ specification.
 */
export function packUsdzArchive(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  if (entries.length === 0) throw new RangeError('USDZ archive requires at least one entry');
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const sum = crc32(entry.data);
    const { localHeader, central } = buildZipEntryHeaders(nameBytes, entry.data.byteLength, sum, offset);
    localParts.push(localHeader, entry.data);
    centralParts.push(central);
    offset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, ZIP_EOCD_MAGIC, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, eocd]));
}

/**
 * @description Serialise a {@link TriMesh} into an Apple-spec `.usdz` archive (`model.usda` at 64-byte alignment).
 */
export function toUsdz(mesh: TriMesh, name = 'Part'): Uint8Array {
  const usdaBytes = Buffer.from(toUsda(mesh, name), 'utf8');
  return packUsdzArchive([{ name: 'model.usda', data: usdaBytes }]);
}

/**
 * @description Parse and verify a `.usdz` archive (uncompressed, 64-byte aligned, CRC-checked) and recover its mesh.
 */
export function parseUsdz(bytes: Uint8Array): {
  entries: Array<{ name: string; compressionMethod: number; dataOffset: number; data: Uint8Array }>;
  usda: string;
  mesh: TriMesh;
} {
  if (bytes.byteLength < 30) throw new RangeError('USDZ archive is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: Array<{ name: string; compressionMethod: number; dataOffset: number; data: Uint8Array }> = [];
  let cursor = 0;
  while (cursor + 4 <= bytes.byteLength && view.getUint32(cursor, true) === ZIP_LOCAL_MAGIC) {
    const method = view.getUint16(cursor + 8, true);
    if (method !== 0) throw new RangeError(`USDZ entry uses compression method ${method}; expected 0 (stored)`);
    const expectedCrc = view.getUint32(cursor + 14, true);
    const compSize = view.getUint32(cursor + 18, true);
    const nameLen = view.getUint16(cursor + 26, true);
    const extraLen = view.getUint16(cursor + 28, true);
    const name = Buffer.from(bytes.buffer, bytes.byteOffset + cursor + 30, nameLen).toString('utf8');
    const dataOffset = cursor + 30 + nameLen + extraLen;
    if (dataOffset % USDZ_ALIGNMENT !== 0) {
      throw new RangeError(`USDZ entry "${name}" payload offset ${dataOffset} is not 64-byte aligned`);
    }
    const data = bytes.subarray(dataOffset, dataOffset + compSize);
    if (crc32(data) !== expectedCrc) throw new RangeError(`USDZ entry "${name}" failed CRC-32 verification`);
    entries.push({ name, compressionMethod: method, dataOffset, data });
    cursor = dataOffset + compSize;
  }
  if (entries.length === 0 || !entries[0].name.endsWith('.usda')) {
    throw new RangeError('USDZ first entry must be an uncompressed .usda scene');
  }
  const usda = Buffer.from(entries[0].data.buffer, entries[0].data.byteOffset, entries[0].data.byteLength).toString('utf8');
  const ptsBlock = /point3f\[\]\s+points\s*=\s*\[([^\]]*)\]/.exec(usda);
  const idxBlock = /int\[\]\s+faceVertexIndices\s*=\s*\[([^\]]*)\]/.exec(usda);
  if (!ptsBlock || !idxBlock) throw new RangeError('USDA scene is missing points or faceVertexIndices');
  const vertices: Vec3[] = [];
  for (const m of ptsBlock[1].matchAll(/\(\s*([+-]?[^,\s)]+)\s*,\s*([+-]?[^,\s)]+)\s*,\s*([+-]?[^,\s)]+)\s*\)/g)) {
    vertices.push({ x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) });
  }
  const rawIdx = idxBlock[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const triangles: Triangle[] = [];
  for (let i = 0; i + 2 < rawIdx.length; i += 3) {
    triangles.push([rawIdx[i], rawIdx[i + 1], rawIdx[i + 2]]);
  }
  return { entries, usda, mesh: { vertices, triangles } };
}
