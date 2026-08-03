"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.STL_FACET_BYTES = exports.STL_HEADER_BYTES = void 0;
exports.stlBinaryByteLength = stlBinaryByteLength;
exports.toStlBinary = toStlBinary;
exports.sanitizeSolidName = sanitizeSolidName;
exports.toStlAscii = toStlAscii;
const logger_1 = require("@/shared/logger");
const mesh_metrics_1 = require("./mesh-metrics");
const format_number_1 = require("./format-number");
const vector_math_1 = require("./vector-math");
const log = (0, logger_1.createChildLogger)({ module: 'shared/geometry/export-stl' });
/** @description Fixed STL header size, bytes. */
exports.STL_HEADER_BYTES = 80;
/** @description Bytes per binary facet: 12 floats × 4 + a uint16 attribute word. */
exports.STL_FACET_BYTES = 50;
/**
 * @description Exact byte length a binary STL of this facet count must have. Exposed so callers
 * (and guards) can assert the size without re-deriving the format's arithmetic.
 * @param triangleCount - Facet count.
 * @returns `80 + 4 + 50 · triangleCount`.
 */
function stlBinaryByteLength(triangleCount) {
    return exports.STL_HEADER_BYTES + 4 + exports.STL_FACET_BYTES * triangleCount;
}
/**
 * @description Write the 80-byte header. ASCII, space-padded, and never starting with the token
 * `solid` — see the change log.
 * @param view - Destination view.
 * @param text - Banner text; truncated to fit.
 * @returns Nothing; the view is written in place.
 */
function writeHeader(view, text) {
    for (let i = 0; i < exports.STL_HEADER_BYTES; i += 1) {
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
function writeFacet(view, offset, normal, corners) {
    let at = offset;
    for (const vector of [normal, ...corners]) {
        view.setFloat32(at, (0, format_number_1.assertFinite)(vector.x, 'STL coordinate'), true);
        view.setFloat32(at + 4, (0, format_number_1.assertFinite)(vector.y, 'STL coordinate'), true);
        view.setFloat32(at + 8, (0, format_number_1.assertFinite)(vector.z, 'STL coordinate'), true);
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
function toStlBinary(mesh) {
    const count = mesh.triangles.length;
    const buffer = new ArrayBuffer(stlBinaryByteLength(count));
    const view = new DataView(buffer);
    writeHeader(view, `oshal geometry binary STL - ${count} facets`);
    view.setUint32(exports.STL_HEADER_BYTES, count, true);
    const normals = (0, mesh_metrics_1.recomputeNormals)(mesh);
    for (let i = 0; i < count; i += 1) {
        const corners = (0, vector_math_1.resolveTriangle)(mesh, mesh.triangles[i], i);
        writeFacet(view, exports.STL_HEADER_BYTES + 4 + exports.STL_FACET_BYTES * i, normals[i], corners);
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
function sanitizeSolidName(name, fallback) {
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
function toStlAscii(mesh, name = 'oshal_mesh') {
    const solid = sanitizeSolidName(name, 'oshal_mesh');
    const normals = (0, mesh_metrics_1.recomputeNormals)(mesh);
    const lines = [`solid ${solid}`];
    for (let i = 0; i < mesh.triangles.length; i += 1) {
        const normal = normals[i];
        lines.push(`  facet normal ${(0, format_number_1.formatFloat)(normal.x)} ${(0, format_number_1.formatFloat)(normal.y)} ${(0, format_number_1.formatFloat)(normal.z)}`);
        lines.push('    outer loop');
        for (const corner of (0, vector_math_1.resolveTriangle)(mesh, mesh.triangles[i], i)) {
            lines.push(`      vertex ${(0, format_number_1.formatFloat)(corner.x)} ${(0, format_number_1.formatFloat)(corner.y)} ${(0, format_number_1.formatFloat)(corner.z)}`);
        }
        lines.push('    endloop');
        lines.push('  endfacet');
    }
    lines.push(`endsolid ${solid}`);
    log.debug({ facets: mesh.triangles.length, solid }, 'wrote ASCII STL');
    return `${lines.join('\n')}\n`;
}
