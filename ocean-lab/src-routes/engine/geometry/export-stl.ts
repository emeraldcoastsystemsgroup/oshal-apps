/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the two STL dialects. The binary writer builds
 *                     |                             | the buffer at its EXACT final size (84 + 50n) up front rather
 *                     |                             | than growing one: the size is a hard property of the format, so
 *                     |                             | allocating it is also asserting it, and any arithmetic slip
 *                     |                             | fails at the first write instead of producing a file that most
 *                     |                             | slicers read and one truncates. The header deliberately does
 *                     |                             | NOT begin with "solid" — readers sniff that word to decide
 *                     |                             | ASCII vs binary, and a binary file that starts with it gets
 *                     |                             | parsed as text and rejected as empty.
 */

import { createChildLogger } from '@/shared/logger';
import type { TriMesh, Vec3 } from './geometry-types';
import { recomputeNormals } from './mesh-metrics';
import { assertFinite, formatFloat } from './format-number';
import { resolveTriangle } from './vector-math';

const log = createChildLogger({ module: 'shared/geometry/export-stl' });

/** @description Fixed STL header size, bytes. */
export const STL_HEADER_BYTES = 80;

/** @description Bytes per binary facet: 12 floats × 4 + a uint16 attribute word. */
export const STL_FACET_BYTES = 50;

/**
 * @description Exact byte length a binary STL of this facet count must have. Exposed so callers
 * (and guards) can assert the size without re-deriving the format's arithmetic.
 * @param triangleCount - Facet count.
 * @returns `80 + 4 + 50 · triangleCount`.
 */
export function stlBinaryByteLength(triangleCount: number): number {
  return STL_HEADER_BYTES + 4 + STL_FACET_BYTES * triangleCount;
}

/**
 * @description Write the 80-byte header. ASCII, space-padded, and never starting with the token
 * `solid` — see the change log.
 * @param view - Destination view.
 * @param text - Banner text; truncated to fit.
 * @returns Nothing; the view is written in place.
 */
function writeHeader(view: DataView, text: string): void {
  for (let i = 0; i < STL_HEADER_BYTES; i += 1) {
    const code = i < text.length ? text.charCodeAt(i) : 0x20;
    view.setUint8(i, code > 0 && code < 0x80 ? code : 0x20);
  }
}

/**
 * @description Write one 50-byte facet record: normal, three vertices, attribute word.
 * @param view - Destination view.
 * @param offset - Byte offset of this facet's record.
 * @param normal - Facet normal.
 * @param corners - The three vertices in winding order.
 * @returns Nothing; the view is written in place.
 * @throws RangeError when any coordinate is not finite.
 */
function writeFacet(view: DataView, offset: number, normal: Vec3, corners: [Vec3, Vec3, Vec3]): void {
  let at = offset;
  for (const vector of [normal, ...corners]) {
    view.setFloat32(at, assertFinite(vector.x, 'STL coordinate'), true);
    view.setFloat32(at + 4, assertFinite(vector.y, 'STL coordinate'), true);
    view.setFloat32(at + 8, assertFinite(vector.z, 'STL coordinate'), true);
    at += 12;
  }
  view.setUint16(at, 0, true);
}

/**
 * @description Serialise a mesh as binary STL — the format every slicer takes and the one to use
 * for anything above a few thousand facets (an ASCII STL of the same part is roughly six times
 * the size).
 *
 * Coordinates are float32 because the format is float32; a caller working at micron precision on
 * a metre-scale part should scale to millimetres before exporting rather than expect the file to
 * carry doubles.
 * @param mesh - Mesh to write. Should be watertight — see {@link validateMesh}.
 * @returns The complete file, exactly {@link stlBinaryByteLength} bytes long.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
export function toStlBinary(mesh: TriMesh): Uint8Array {
  const count = mesh.triangles.length;
  const buffer = new ArrayBuffer(stlBinaryByteLength(count));
  const view = new DataView(buffer);
  writeHeader(view, `oshal geometry binary STL - ${count} facets`);
  view.setUint32(STL_HEADER_BYTES, count, true);
  const normals = recomputeNormals(mesh);
  for (let i = 0; i < count; i += 1) {
    const corners = resolveTriangle(mesh, mesh.triangles[i], i);
    writeFacet(view, STL_HEADER_BYTES + 4 + STL_FACET_BYTES * i, normals[i], corners);
  }
  log.debug({ facets: count, bytes: buffer.byteLength }, 'wrote binary STL');
  return new Uint8Array(buffer);
}

/**
 * @description Sanitise a solid name for the text formats: STL/OBJ readers tokenise on
 * whitespace, so a name with a space silently becomes two tokens and the trailing `endsolid`
 * stops matching.
 * @param name - Requested name.
 * @param fallback - Name to use when the requested one sanitises to nothing.
 * @returns A single-token name.
 */
export function sanitizeSolidName(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * @description Serialise a mesh as ASCII STL — human-readable and diffable, which is what makes it
 * worth keeping alongside the binary writer for fixtures and small parts.
 * @param mesh - Mesh to write.
 * @param name - Solid name; sanitised to a single token. Default `oshal_mesh`.
 * @returns The complete file text, newline-terminated.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
export function toStlAscii(mesh: TriMesh, name = 'oshal_mesh'): string {
  const solid = sanitizeSolidName(name, 'oshal_mesh');
  const normals = recomputeNormals(mesh);
  const lines: string[] = [`solid ${solid}`];
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const normal = normals[i];
    lines.push(`  facet normal ${formatFloat(normal.x)} ${formatFloat(normal.y)} ${formatFloat(normal.z)}`);
    lines.push('    outer loop');
    for (const corner of resolveTriangle(mesh, mesh.triangles[i], i)) {
      lines.push(`      vertex ${formatFloat(corner.x)} ${formatFloat(corner.y)} ${formatFloat(corner.z)}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${solid}`);
  log.debug({ facets: mesh.triangles.length, solid }, 'wrote ASCII STL');
  return `${lines.join('\n')}\n`;
}
