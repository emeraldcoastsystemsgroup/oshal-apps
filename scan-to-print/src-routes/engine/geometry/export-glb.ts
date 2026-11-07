/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Binary glTF 2.0 (.glb) writer and round-trip reader (RP-SCN-04). Converts millimetre Z-up meshes into spec-compliant metre Y-up glTF scenes for DCC tools, WebXR, and Android Scene Viewer.
 */

import type { Triangle, TriMesh, Vec3 } from './geometry-types';
import { assertFinite } from './format-number';
import { crossVec, resolveTriangle } from './vector-math';

/** @description glTF 2.0 binary magic (`"glTF"` in ASCII, little-endian uint32). */
export const GLB_MAGIC = 0x46546c67;
/** @description glTF 2.0 binary container version. */
export const GLB_VERSION = 2;
/** @description JSON chunk type (`"JSON"`). */
export const GLB_CHUNK_JSON = 0x4e4f534a;
/** @description Binary buffer chunk type (`"BIN\0"`). */
export const GLB_CHUNK_BIN = 0x004e4942;

const HALF_SQRT2 = Math.SQRT1_2;

export interface GlbExportOptions {
  /** Scene/node/mesh name. */
  name?: string;
  /** Base RGBA color in linear [0..1]. */
  baseColor?: [number, number, number, number];
}

function computeVertexNormals(mesh: TriMesh): Float32Array {
  const normals = new Float32Array(mesh.vertices.length * 3);
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const [i0, i1, i2] = mesh.triangles[i];
    const [a, b, c] = resolveTriangle(mesh, mesh.triangles[i], i);
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const weighted = crossVec(ab, ac);
    for (const idx of [i0, i1, i2]) {
      normals[idx * 3] += weighted.x;
      normals[idx * 3 + 1] += weighted.y;
      normals[idx * 3 + 2] += weighted.z;
    }
  }
  for (let v = 0; v < mesh.vertices.length; v += 1) {
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      normals[v * 3] = nx / len;
      normals[v * 3 + 1] = ny / len;
      normals[v * 3 + 2] = nz / len;
    } else {
      normals[v * 3 + 2] = 1;
    }
  }
  return normals;
}

function buildGlbBuffers(mesh: TriMesh): {
  bin: Uint8Array;
  posBytes: number;
  normBytes: number;
  idxBytes: number;
  minPos: [number, number, number];
  maxPos: [number, number, number];
} {
  const vCount = mesh.vertices.length;
  const tCount = mesh.triangles.length;
  if (vCount === 0 || tCount === 0) throw new RangeError('GLB export requires a non-empty mesh');
  const posBytes = vCount * 12;
  const normBytes = vCount * 12;
  const idxBytes = tCount * 12;
  const rawLen = posBytes + normBytes + idxBytes;
  const paddedLen = (rawLen + 3) & ~3;
  const buf = new ArrayBuffer(paddedLen);
  const view = new DataView(buf);
  const minPos: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxPos: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vCount; i += 1) {
    const v = mesh.vertices[i];
    const fx = Math.fround(assertFinite(v.x, 'GLB vertex X'));
    const fy = Math.fround(assertFinite(v.y, 'GLB vertex Y'));
    const fz = Math.fround(assertFinite(v.z, 'GLB vertex Z'));
    view.setFloat32(i * 12, fx, true);
    view.setFloat32(i * 12 + 4, fy, true);
    view.setFloat32(i * 12 + 8, fz, true);
    if (fx < minPos[0]) minPos[0] = fx;
    if (fy < minPos[1]) minPos[1] = fy;
    if (fz < minPos[2]) minPos[2] = fz;
    if (fx > maxPos[0]) maxPos[0] = fx;
    if (fy > maxPos[1]) maxPos[1] = fy;
    if (fz > maxPos[2]) maxPos[2] = fz;
  }
  const normals = computeVertexNormals(mesh);
  for (let i = 0; i < normals.length; i += 1) {
    view.setFloat32(posBytes + i * 4, normals[i], true);
  }
  const idxOffset = posBytes + normBytes;
  for (let i = 0; i < tCount; i += 1) {
    const [a, b, c] = mesh.triangles[i];
    resolveTriangle(mesh, mesh.triangles[i], i);
    view.setUint32(idxOffset + i * 12, a, true);
    view.setUint32(idxOffset + i * 12 + 4, b, true);
    view.setUint32(idxOffset + i * 12 + 8, c, true);
  }
  return { bin: new Uint8Array(buf), posBytes, normBytes, idxBytes, minPos, maxPos };
}

function buildGltfDocument(
  mesh: TriMesh,
  name: string,
  color: [number, number, number, number],
  buf: { bin: Uint8Array; posBytes: number; normBytes: number; idxBytes: number; minPos: number[]; maxPos: number[] },
): Record<string, unknown> {
  return {
    asset: { version: '2.0', generator: 'oshal scan-to-print' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0, rotation: [-HALF_SQRT2, 0, 0, HALF_SQRT2], scale: [0.001, 0.001, 0.001] }],
    materials: [{
      name: 'part_material',
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0.08, roughnessFactor: 0.55 },
    }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4, material: 0 }] }],
    buffers: [{ byteLength: buf.bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: buf.posBytes, target: 34962 },
      { buffer: 0, byteOffset: buf.posBytes, byteLength: buf.normBytes, target: 34962 },
      { buffer: 0, byteOffset: buf.posBytes + buf.normBytes, byteLength: buf.idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.vertices.length, type: 'VEC3', min: buf.minPos, max: buf.maxPos },
      { bufferView: 1, componentType: 5126, count: mesh.vertices.length, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: mesh.triangles.length * 3, type: 'SCALAR' },
    ],
  };
}

/**
 * @description Serialise a millimetre Z-up {@link TriMesh} into a binary glTF 2.0 (`.glb`) container.
 * @param mesh - Indexed triangle mesh in millimetres (Z-up).
 * @param opts - Optional part name and linear RGBA material tint.
 * @returns Binary `.glb` file bytes starting with `0x46546C67` (`glTF`).
 */
export function toGlb(mesh: TriMesh, opts: GlbExportOptions = {}): Uint8Array {
  const name = (opts.name ?? 'oshal_part').trim() || 'oshal_part';
  const color = opts.baseColor ?? [0.82, 0.85, 0.89, 1];
  const buf = buildGlbBuffers(mesh);
  const gltf = buildGltfDocument(mesh, name, color, buf);
  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPaddedLen = (jsonRaw.byteLength + 3) & ~3;
  const totalLen = 12 + 8 + jsonPaddedLen + 8 + buf.bin.byteLength;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLen, true);
  view.setUint32(12, jsonPaddedLen, true);
  view.setUint32(16, GLB_CHUNK_JSON, true);
  out.set(jsonRaw, 20);
  for (let i = jsonRaw.byteLength; i < jsonPaddedLen; i += 1) out[20 + i] = 0x20;
  const binHeader = 20 + jsonPaddedLen;
  view.setUint32(binHeader, buf.bin.byteLength, true);
  view.setUint32(binHeader + 4, GLB_CHUNK_BIN, true);
  out.set(buf.bin, binHeader + 8);
  return out;
}

/**
 * @description Parse and validate a binary `.glb` payload back into its glTF JSON document and {@link TriMesh}.
 * @param bytes - `.glb` container bytes.
 * @returns Parsed JSON header and recovered millimetre mesh.
 */
export function parseGlb(bytes: Uint8Array): { json: Record<string, unknown>; mesh: TriMesh } {
  if (bytes.byteLength < 28) throw new RangeError('GLB is shorter than minimum container header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) throw new RangeError(`Invalid GLB magic 0x${magic.toString(16)}`);
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) throw new RangeError(`Unsupported GLB version ${version}`);
  const declaredLen = view.getUint32(8, true);
  if (declaredLen !== bytes.byteLength) throw new RangeError('GLB length header does not match payload size');
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== GLB_CHUNK_JSON) throw new RangeError('First GLB chunk must be JSON');
  const jsonText = Buffer.from(bytes.buffer, bytes.byteOffset + 20, jsonLen).toString('utf8').trimEnd();
  const json = JSON.parse(jsonText) as Record<string, any>;
  const binHeader = 20 + jsonLen;
  const binLen = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== GLB_CHUNK_BIN) throw new RangeError('Second GLB chunk must be BIN');
  const binStart = bytes.byteOffset + binHeader + 8;
  const binView = new DataView(bytes.buffer, binStart, binLen);
  const posAcc = json.accessors[0];
  const posBv = json.bufferViews[posAcc.bufferView];
  const idxAcc = json.accessors[2];
  const idxBv = json.bufferViews[idxAcc.bufferView];
  const vertices: Vec3[] = [];
  for (let i = 0; i < posAcc.count; i += 1) {
    const at = (posBv.byteOffset ?? 0) + i * 12;
    vertices.push({ x: binView.getFloat32(at, true), y: binView.getFloat32(at + 4, true), z: binView.getFloat32(at + 8, true) });
  }
  const triangles: Triangle[] = [];
  const step = idxAcc.componentType === 5123 ? 2 : 4;
  for (let i = 0; i < idxAcc.count; i += 3) {
    const at = (idxBv.byteOffset ?? 0) + i * step;
    const read = (off: number) => (step === 2 ? binView.getUint16(off, true) : binView.getUint32(off, true));
    triangles.push([read(at), read(at + step), read(at + step * 2)]);
  }
  return { json, mesh: { vertices, triangles } };
}
