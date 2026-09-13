"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendored from the ocean-lab geometry slice: the two STL dialects.
 *                     |                             | The binary writer allocates the buffer at its EXACT final size
 *                     |                             | (84 + 50n) so an arithmetic slip fails at the first write, and
 *                     |                             | the header never begins with "solid" (readers sniff that word
 *                     |                             | to pick ASCII vs binary). Logger import dropped — pure engine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STL_FACET_BYTES = exports.STL_HEADER_BYTES = void 0;
exports.stlBinaryByteLength = stlBinaryByteLength;
exports.toStlBinary = toStlBinary;
exports.sanitizeSolidName = sanitizeSolidName;
exports.toStlAscii = toStlAscii;
const mesh_metrics_1 = require("./mesh-metrics");
const format_number_1 = require("./format-number");
const vector_math_1 = require("./vector-math");
/** @description Fixed STL header size, bytes. */
exports.STL_HEADER_BYTES = 80;
/** @description Bytes per binary facet: 12 floats × 4 + a uint16 attribute word. */
exports.STL_FACET_BYTES = 50;
/**
 * @description Exact byte length a binary STL of this facet count must have.
 * @param triangleCount - Facet count.
 * @returns `80 + 4 + 50 · triangleCount`.
 */
function stlBinaryByteLength(triangleCount) {
    return exports.STL_HEADER_BYTES + 4 + exports.STL_FACET_BYTES * triangleCount;
}
/**
 * @description Write the 80-byte header: ASCII, space-padded, never starting with `solid`.
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
 * @description Serialise a mesh as binary STL — the format every slicer takes. Coordinates are
 * float32 because the format is float32; the mesher emits millimetres, which is the right unit.
 * @param mesh - Mesh to write. Should be watertight — see {@link validateMesh}.
 * @returns The complete file, exactly {@link stlBinaryByteLength} bytes long.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
function toStlBinary(mesh) {
    const count = mesh.triangles.length;
    const buffer = new ArrayBuffer(stlBinaryByteLength(count));
    const view = new DataView(buffer);
    writeHeader(view, `oshal scan-to-print binary STL - ${count} facets`);
    view.setUint32(exports.STL_HEADER_BYTES, count, true);
    const normals = (0, mesh_metrics_1.recomputeNormals)(mesh);
    for (let i = 0; i < count; i += 1) {
        const corners = (0, vector_math_1.resolveTriangle)(mesh, mesh.triangles[i], i);
        writeFacet(view, exports.STL_HEADER_BYTES + 4 + exports.STL_FACET_BYTES * i, normals[i], corners);
    }
    return new Uint8Array(buffer);
}
/**
 * @description Sanitise a solid name for the text formats: readers tokenise on whitespace, so a
 * name with a space silently becomes two tokens and the trailing `endsolid` stops matching.
 * @param name - Requested name.
 * @param fallback - Name to use when the requested one sanitises to nothing.
 * @returns A single-token name.
 */
function sanitizeSolidName(name, fallback) {
    const cleaned = name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned.length > 0 ? cleaned : fallback;
}
/**
 * @description Serialise a mesh as ASCII STL — human-readable and diffable, worth keeping for
 * fixtures and small parts.
 * @param mesh - Mesh to write.
 * @param name - Solid name; sanitised to a single token. Default `oshal_part`.
 * @returns The complete file text, newline-terminated.
 * @throws RangeError when a facet references a missing vertex or a coordinate is not finite.
 */
function toStlAscii(mesh, name = 'oshal_part') {
    const solid = sanitizeSolidName(name, 'oshal_part');
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
    return `${lines.join('\n')}\n`;
}
//# sourceMappingURL=export-stl.js.map