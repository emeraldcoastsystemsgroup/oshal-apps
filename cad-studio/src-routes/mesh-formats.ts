/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | 0.5.0: Wavefront OBJ + MTL, Open Packaging Conventions 3MF ZIP, binary glTF 2.0 (GLB), and uncompressed 64-byte-aligned Apple USDZ mesh converters + round-trip parsers for CAD revisions (RP-CAD-03, RP-CAD-04).
 */

import zlib from 'node:zlib';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TriMesh {
  vertices: Vec3[];
  triangles: Array<[number, number, number]>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function safeIdentifier(raw: string, fallback = 'cad_part'): string {
  const cleaned = String(raw || '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `p_${cleaned}` : cleaned;
}

function escapeXml(raw: string): string {
  return String(raw || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function weldTriplets(coords: number[]): TriMesh {
  const vertices: Vec3[] = [];
  const triangles: Array<[number, number, number]> = [];
  const indexByKey = new Map<string, number>();
  const addVertex = (x: number, y: number, z: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new RangeError('STL coordinates must be finite numbers');
    }
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push({ x, y, z });
    indexByKey.set(key, idx);
    return idx;
  };
  const triCount = Math.floor(coords.length / 9);
  for (let i = 0; i < triCount; i += 1) {
    const o = i * 9;
    const a = addVertex(coords[o], coords[o + 1], coords[o + 2]);
    const b = addVertex(coords[o + 3], coords[o + 4], coords[o + 5]);
    const c = addVertex(coords[o + 6], coords[o + 7], coords[o + 8]);
    if (a !== b && b !== c && c !== a) triangles.push([a, b, c]);
  }
  return { vertices, triangles };
}

/** @description Parse binary or ASCII STL bytes into a welded indexed triangle mesh. */
export function fromStl(bytes: Uint8Array): TriMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84 && bytes.byteLength === 84 + 50 * view.getUint32(80, true)) {
    const count = view.getUint32(80, true);
    const coords = new Array<number>(count * 9);
    for (let i = 0; i < count; i += 1) {
      const base = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k += 1) coords[i * 9 + k] = view.getFloat32(base + k * 4, true);
    }
    return weldTriplets(coords);
  }
  const text = new TextDecoder().decode(bytes);
  const coords: number[] = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    coords.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return weldTriplets(coords);
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/** @description Serialize a mesh to Wavefront OBJ referencing its companion MTL library. */
export function toObj(mesh: TriMesh, name = 'cad_part', mtlFile = 'model.mtl'): string {
  const objName = safeIdentifier(name, 'cad_part');
  const lines = [
    '# CAD Studio Wavefront OBJ export (units: mm)',
    `mtllib ${mtlFile}`,
    `o ${objName}`,
  ];
  for (const v of mesh.vertices) {
    lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
  }
  for (const [ia, ib, ic] of mesh.triangles) {
    const n = faceNormal(mesh.vertices[ia], mesh.vertices[ib], mesh.vertices[ic]);
    lines.push(`vn ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}`);
  }
  lines.push('usemtl cad_part_mat', 's off');
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const [ia, ib, ic] = mesh.triangles[i];
    const ni = i + 1;
    lines.push(`f ${ia + 1}//${ni} ${ib + 1}//${ni} ${ic + 1}//${ni}`);
  }
  return `${lines.join('\n')}\n`;
}

/** @description Companion Wavefront MTL material library for CAD Studio OBJ exports. */
export function toMtl(materialName = 'cad_part_mat'): string {
  return [
    '# CAD Studio Wavefront MTL',
    `newmtl ${safeIdentifier(materialName, 'cad_part_mat')}`,
    'Ka 0.180000 0.220000 0.280000',
    'Kd 0.620000 0.680000 0.780000',
    'Ks 0.250000 0.250000 0.250000',
    'Ns 48.000000',
    'd 1.000000',
    'illum 2',
    '',
  ].join('\n');
}

/** @description Parse Wavefront OBJ text back into vertices and 0-based triangles. */
export function parseObj(text: string): TriMesh {
  const vertices: Vec3[] = [];
  const triangles: Array<[number, number, number]> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      vertices.push({ x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) });
    } else if (line.startsWith('f ')) {
      const idx = line.slice(2).trim().split(/\s+/).map((tok) => Number(tok.split('/')[0]) - 1);
      for (let i = 1; i + 1 < idx.length; i += 1) triangles.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return { vertices, triangles };
}

interface ZipInputEntry {
  name: string;
  data: Uint8Array;
}

function makeLocalZipRecord(nameBytes: Uint8Array, rawData: Uint8Array, offset: number, compress: boolean, alignBytes: number): {
  local: Buffer;
  central: Buffer;
} {
  const crc = crc32(rawData);
  const body = compress ? zlib.deflateRawSync(rawData) : Buffer.from(rawData);
  const method = compress ? 8 : 0;
  const baseDataOffset = offset + 30 + nameBytes.byteLength;
  const rem = alignBytes > 1 ? baseDataOffset % alignBytes : 0;
  const extraLen = rem === 0 ? 0 : alignBytes - rem;
  const local = Buffer.alloc(30 + nameBytes.byteLength + extraLen + body.byteLength);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.byteLength, 18);
  local.writeUInt32LE(rawData.byteLength, 22);
  local.writeUInt16LE(nameBytes.byteLength, 26);
  local.writeUInt16LE(extraLen, 28);
  local.set(nameBytes, 30);
  local.set(body, 30 + nameBytes.byteLength + extraLen);

  const central = Buffer.alloc(46 + nameBytes.byteLength);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.byteLength, 20);
  central.writeUInt32LE(rawData.byteLength, 24);
  central.writeUInt16LE(nameBytes.byteLength, 28);
  central.writeUInt32LE(offset, 42);
  central.set(nameBytes, 46);
  return { local, central };
}

function buildZipArchive(entries: ZipInputEntry[], opts: { compress: boolean; alignBytes: number }): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const rec = makeLocalZipRecord(nameBytes, entry.data, offset, opts.compress, opts.alignBytes);
    locals.push(rec.local);
    centrals.push(rec.central);
    offset += rec.local.byteLength;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralBuf, eocd]));
}

export interface ParsedZipEntry {
  name: string;
  compressionMethod: number;
  dataOffset: number;
  data: Uint8Array;
}

function readZipArchive(bytes: Uint8Array): ParsedZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new RangeError('Invalid ZIP archive: missing EOCD signature');
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdPos = buf.readUInt32LE(eocdOffset + 16);
  const out: ParsedZipEntry[] = [];
  for (let i = 0; i < totalEntries; i += 1) {
    if (buf.readUInt32LE(cdPos) !== 0x02014b50) throw new RangeError('Invalid ZIP central directory header');
    const method = buf.readUInt16LE(cdPos + 10);
    const expectedCrc = buf.readUInt32LE(cdPos + 16);
    const compSize = buf.readUInt32LE(cdPos + 20);
    const nameLen = buf.readUInt16LE(cdPos + 28);
    const cdExtra = buf.readUInt16LE(cdPos + 30);
    const cdComment = buf.readUInt16LE(cdPos + 32);
    const localOffset = buf.readUInt32LE(cdPos + 42);
    const name = buf.subarray(cdPos + 46, cdPos + 46 + nameLen).toString('utf8');
    cdPos += 46 + nameLen + cdExtra + cdComment;
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new RangeError('Invalid ZIP local header');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    const slice = buf.subarray(dataOffset, dataOffset + compSize);
    const data = method === 0 ? new Uint8Array(slice) : method === 8 ? new Uint8Array(zlib.inflateRawSync(slice)) : (() => { throw new RangeError(`Unsupported ZIP method ${method}`); })();
    if (crc32(data) !== expectedCrc) throw new RangeError(`CRC mismatch in ZIP entry ${name}`);
    out.push({ name, compressionMethod: method, dataOffset, data });
  }
  return out;
}

function build3mfModelXml(mesh: TriMesh, title: string): string {
  const cleanTitle = escapeXml(title || 'CAD Studio part');
  const vLines = mesh.vertices.map((v) => `          <vertex x="${v.x.toFixed(6)}" y="${v.y.toFixed(6)}" z="${v.z.toFixed(6)}" />`);
  const tLines = mesh.triangles.map(([a, b, c]) => `          <triangle v1="${a}" v2="${b}" v3="${c}" />`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `  <metadata name="Title">${cleanTitle}</metadata>`,
    '  <resources>',
    `    <object id="1" name="${cleanTitle}" type="model">`,
    '      <mesh>',
    '        <vertices>',
    ...vLines,
    '        </vertices>',
    '        <triangles>',
    ...tLines,
    '        </triangles>',
    '      </mesh>',
    '    </object>',
    '  </resources>',
    '  <build>',
    '    <item objectid="1" />',
    '  </build>',
    '</model>',
    '',
  ].join('\n');
}

/** @description Package a mesh as a standards-compliant Open Packaging Conventions 3MF archive. */
export function to3mf(mesh: TriMesh, title = 'cad_part'): Uint8Array {
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />',
    '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />',
    '</Types>',
  ].join('\n');
  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />',
    '</Relationships>',
  ].join('\n');
  const modelXml = build3mfModelXml(mesh, title);
  return buildZipArchive([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: '3D/3dmodel.model', data: Buffer.from(modelXml, 'utf8') },
  ], { compress: true, alignBytes: 1 });
}

/** @description Parse and verify a 3MF OPC ZIP package back into its unit, metadata title, file list, and triangle mesh. */
export function parse3mf(bytes: Uint8Array): { unit: string; title: string; files: string[]; mesh: TriMesh } {
  const entries = readZipArchive(bytes);
  const files = entries.map((e) => e.name);
  const modelEntry = entries.find((e) => e.name === '3D/3dmodel.model');
  if (!modelEntry || !files.includes('[Content_Types].xml') || !files.includes('_rels/.rels')) {
    throw new RangeError('3MF archive is missing required OPC package parts');
  }
  const xml = Buffer.from(modelEntry.data).toString('utf8');
  const unit = /<model\b[^>]*\bunit="([^"]+)"/.exec(xml)?.[1] ?? 'millimeter';
  const title = /<metadata\s+name="Title">([\s\S]*?)<\/metadata>/.exec(xml)?.[1] ?? '';
  const vertices: Vec3[] = [];
  const vRe = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g;
  let vm: RegExpExecArray | null;
  while ((vm = vRe.exec(xml)) !== null) vertices.push({ x: Number(vm[1]), y: Number(vm[2]), z: Number(vm[3]) });
  const triangles: Array<[number, number, number]> = [];
  const tRe = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"\s*\/>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tRe.exec(xml)) !== null) triangles.push([Number(tm[1]), Number(tm[2]), Number(tm[3])]);
  return { unit, title, files, mesh: { vertices, triangles } };
}

function buildGlbBuffers(mesh: TriMesh): { bin: Buffer; triVerts: number; posMin: number[]; posMax: number[] } {
  const triVerts = mesh.triangles.length * 3;
  const pos = new Float32Array(triVerts * 3);
  const nor = new Float32Array(triVerts * 3);
  const idx = new Uint32Array(triVerts);
  const posMin = [Infinity, Infinity, Infinity], posMax = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < mesh.triangles.length; t += 1) {
    const tri = mesh.triangles[t];
    const n = faceNormal(mesh.vertices[tri[0]], mesh.vertices[tri[1]], mesh.vertices[tri[2]]);
    const ny = [n.x, n.z, -n.y];
    for (let k = 0; k < 3; k += 1) {
      const v = mesh.vertices[tri[k]];
      const gx = v.x * 0.001, gy = v.z * 0.001, gz = -v.y * 0.001;
      const vi = t * 3 + k;
      pos.set([gx, gy, gz], vi * 3);
      nor.set(ny, vi * 3);
      idx[vi] = vi;
      posMin[0] = Math.min(posMin[0], gx); posMin[1] = Math.min(posMin[1], gy); posMin[2] = Math.min(posMin[2], gz);
      posMax[0] = Math.max(posMax[0], gx); posMax[1] = Math.max(posMax[1], gy); posMax[2] = Math.max(posMax[2], gz);
    }
  }
  const rawBin = Buffer.concat([
    Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength),
    Buffer.from(nor.buffer, nor.byteOffset, nor.byteLength),
    Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength),
  ]);
  const pad = (4 - (rawBin.byteLength % 4)) % 4;
  return {
    bin: pad ? Buffer.concat([rawBin, Buffer.alloc(pad)]) : rawBin,
    triVerts,
    posMin: triVerts ? posMin : [0, 0, 0],
    posMax: triVerts ? posMax : [0, 0, 0],
  };
}

/** @description Serialize a CAD mesh (Z-up mm) to binary glTF 2.0 (.glb, Y-up metres) for AR and 3D viewers. */
export function toGlb(mesh: TriMesh, name = 'cad_part'): Uint8Array {
  const { bin, triVerts, posMin, posMax } = buildGlbBuffers(mesh);
  const vecBytes = triVerts * 12;
  const idxBytes = triVerts * 4;
  const doc = {
    asset: { version: '2.0', generator: 'oshal-cad-studio' },
    scene: 0,
    scenes: [{ name: safeIdentifier(name), nodes: [0] }],
    nodes: [{ name: safeIdentifier(name), mesh: 0 }],
    materials: [{ name: 'cad_part_mat', pbrMetallicRoughness: { baseColorFactor: [0.62, 0.68, 0.78, 1], metallicFactor: 0.15, roughnessFactor: 0.55 }, doubleSided: true }],
    meshes: [{ name: safeIdentifier(name), primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }], extras: { sourceUnits: 'mm', sourceUpAxis: 'Z' } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vecBytes, target: 34962 },
      { buffer: 0, byteOffset: vecBytes, byteLength: vecBytes, target: 34962 },
      { buffer: 0, byteOffset: vecBytes * 2, byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: triVerts, type: 'VEC3', min: posMin, max: posMax },
      { bufferView: 1, componentType: 5126, count: triVerts, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: triVerts, type: 'SCALAR' },
    ],
  };
  const jsonRaw = Buffer.from(JSON.stringify(doc), 'utf8');
  const jsonPad = (4 - (jsonRaw.byteLength % 4)) % 4;
  const jsonChunk = jsonPad ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;
  const total = 12 + 8 + jsonChunk.byteLength + 8 + bin.byteLength;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.byteLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binHeader = 20 + jsonChunk.byteLength;
  out.writeUInt32LE(bin.byteLength, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(out, binHeader + 8);
  return new Uint8Array(out);
}

/** @description Parse a binary .glb container and convert Y-up metres back to Z-up mm for round-trip verification. */
export function parseGlb(bytes: Uint8Array): { magic: number; version: number; json: Record<string, unknown>; mesh: TriMesh } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.byteLength < 28) throw new RangeError('GLB buffer too short');
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  if (magic !== 0x46546c67 || version !== 2) throw new RangeError('Invalid GLB header');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, any>;
  const binStart = 20 + jsonLen + 8;
  const count = Number(json.accessors?.[0]?.count ?? 0);
  const posFloats = new Float32Array(buf.buffer, buf.byteOffset + binStart, count * 3);
  const coords: number[] = [];
  for (let i = 0; i < count; i += 1) {
    coords.push(posFloats[i * 3] * 1000, -posFloats[i * 3 + 2] * 1000, posFloats[i * 3 + 1] * 1000);
  }
  return { magic, version, json, mesh: weldTriplets(coords) };
}

function buildUsdaText(mesh: TriMesh, name: string): string {
  const prim = safeIdentifier(name, 'cad_part');
  const counts = new Array(mesh.triangles.length).fill(3).join(', ');
  const indices = mesh.triangles.map(([a, b, c]) => `${a}, ${b}, ${c}`).join(', ');
  const points = mesh.vertices.map((v) => `(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`).join(', ');
  const normals = mesh.triangles.flatMap(([a, b, c]) => {
    const n = faceNormal(mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]);
    const tuple = `(${n.x.toFixed(5)}, ${n.y.toFixed(5)}, ${n.z.toFixed(5)})`;
    return [tuple, tuple, tuple];
  }).join(', ');
  return [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${prim}"`,
    '    metersPerUnit = 0.001',
    '    upAxis = "Z"',
    ')',
    `def Xform "${prim}" (`,
    '    kind = "component"',
    ')',
    '{',
    '    def Mesh "Geometry"',
    '    {',
    '        uniform bool doubleSided = 1',
    `        int[] faceVertexCounts = [${counts}]`,
    `        int[] faceVertexIndices = [${indices}]`,
    `        normal3f[] normals = [${normals}] (`,
    '            interpolation = "faceVarying"',
    '        )',
    `        point3f[] points = [${points}]`,
    '        rel material:binding = </Materials/CadSurface>',
    '    }',
    '}',
    'def Scope "Materials"',
    '{',
    '    def Material "CadSurface"',
    '    {',
    '        token outputs:surface.connect = </Materials/CadSurface/PBR.outputs:surface>',
    '        def Shader "PBR"',
    '        {',
    '            uniform token info:id = "UsdPreviewSurface"',
    '            color3f inputs:diffuseColor = (0.62, 0.68, 0.78)',
    '            float inputs:metallic = 0.15',
    '            float inputs:roughness = 0.55',
    '            token outputs:surface',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
}

/** @description Package a CAD mesh into an uncompressed 64-byte-aligned Apple USDZ archive for iOS Quick Look AR. */
export function toUsdz(mesh: TriMesh, name = 'cad_part'): Uint8Array {
  const usda = Buffer.from(buildUsdaText(mesh, name), 'utf8');
  return buildZipArchive([{ name: 'model.usda', data: usda }], { compress: false, alignBytes: 64 });
}

/** @description Parse and verify a USDZ archive (uncompressed 64-byte alignment + USDA mesh geometry). */
export function parseUsdz(bytes: Uint8Array): { entries: ParsedZipEntry[]; usda: string; mesh: TriMesh } {
  const entries = readZipArchive(bytes);
  if (!entries.length || entries[0].compressionMethod !== 0 || entries[0].dataOffset % 64 !== 0) {
    throw new RangeError('USDZ entries must be uncompressed and 64-byte aligned');
  }
  const usda = Buffer.from(entries[0].data).toString('utf8');
  const pointsBlock = /point3f\[\]\s+points\s*=\s*\[([^\]]*)\]/.exec(usda)?.[1] ?? '';
  const idxBlock = /int\[\]\s+faceVertexIndices\s*=\s*\[([^\]]*)\]/.exec(usda)?.[1] ?? '';
  const vertices: Vec3[] = [];
  const pRe = /\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/g;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(pointsBlock)) !== null) vertices.push({ x: Number(pm[1]), y: Number(pm[2]), z: Number(pm[3]) });
  const rawIdx = idxBlock.trim() ? idxBlock.split(',').map((s) => Number(s.trim())) : [];
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < rawIdx.length; i += 3) triangles.push([rawIdx[i], rawIdx[i + 1], rawIdx[i + 2]]);
  return { entries, usda, mesh: { vertices, triangles } };
}
