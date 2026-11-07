"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Binary and ASCII STL reader producing an indexed welded TriMesh for mesh editing (crop, rotate/lay-flat, 3D measurement) and GLB/USDZ export.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromStl = fromStl;
const export_stl_1 = require("./export-stl");
const WELD_SCALE = 1e5;
function weldKey(x, y, z) {
    return `${Math.round(x * WELD_SCALE)},${Math.round(y * WELD_SCALE)},${Math.round(z * WELD_SCALE)}`;
}
function addVertex(vertices, indexByKey, x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new RangeError('STL contains a non-finite vertex coordinate');
    }
    const key = weldKey(x, y, z);
    const existing = indexByKey.get(key);
    if (existing !== undefined)
        return existing;
    const idx = vertices.length;
    vertices.push({ x, y, z });
    indexByKey.set(key, idx);
    return idx;
}
function looksLikeAsciiStl(bytes) {
    if (bytes.byteLength < 16)
        return false;
    let head = '';
    const limit = Math.min(bytes.byteLength, 256);
    for (let i = 0; i < limit; i += 1)
        head += String.fromCharCode(bytes[i]);
    if (!/^\s*solid\b/i.test(head))
        return false;
    return /\bfacet\s+normal\b/i.test(head);
}
function parseBinaryStl(bytes) {
    if (bytes.byteLength < export_stl_1.STL_HEADER_BYTES + 4) {
        throw new RangeError('STL is shorter than the 84-byte binary header');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(export_stl_1.STL_HEADER_BYTES, true);
    if ((0, export_stl_1.stlBinaryByteLength)(count) !== bytes.byteLength) {
        throw new RangeError(`STL byte length (${bytes.byteLength}) does not match facet count (${count})`);
    }
    const vertices = [];
    const triangles = [];
    const indexByKey = new Map();
    for (let i = 0; i < count; i += 1) {
        const base = export_stl_1.STL_HEADER_BYTES + 4 + i * export_stl_1.STL_FACET_BYTES + 12;
        const i0 = addVertex(vertices, indexByKey, view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true));
        const i1 = addVertex(vertices, indexByKey, view.getFloat32(base + 12, true), view.getFloat32(base + 16, true), view.getFloat32(base + 20, true));
        const i2 = addVertex(vertices, indexByKey, view.getFloat32(base + 24, true), view.getFloat32(base + 28, true), view.getFloat32(base + 32, true));
        if (i0 !== i1 && i1 !== i2 && i2 !== i0)
            triangles.push([i0, i1, i2]);
    }
    if (triangles.length === 0)
        throw new RangeError('STL contains no non-degenerate facets');
    return { vertices, triangles };
}
function parseAsciiStl(text) {
    const vertices = [];
    const triangles = [];
    const indexByKey = new Map();
    const vertexPattern = /\bvertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/gi;
    const ring = [];
    for (const match of text.matchAll(vertexPattern)) {
        ring.push(addVertex(vertices, indexByKey, Number(match[1]), Number(match[2]), Number(match[3])));
        if (ring.length === 3) {
            const [i0, i1, i2] = ring;
            ring.length = 0;
            if (i0 !== i1 && i1 !== i2 && i2 !== i0)
                triangles.push([i0, i1, i2]);
        }
    }
    if (triangles.length === 0)
        throw new RangeError('ASCII STL contains no valid facets');
    return { vertices, triangles };
}
/**
 * @description Parse either a binary or ASCII STL payload into an indexed, vertex-welded {@link TriMesh}.
 * @param bytes - Raw STL file bytes.
 * @returns Indexed triangle mesh in the file's millimetre coordinate frame.
 */
function fromStl(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new RangeError('STL payload is empty');
    }
    if (bytes.byteLength >= export_stl_1.STL_HEADER_BYTES + 4) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const count = view.getUint32(export_stl_1.STL_HEADER_BYTES, true);
        if ((0, export_stl_1.stlBinaryByteLength)(count) === bytes.byteLength && !looksLikeAsciiStl(bytes)) {
            return parseBinaryStl(bytes);
        }
    }
    const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
    if (/^\s*solid\b/i.test(text))
        return parseAsciiStl(text);
    return parseBinaryStl(bytes);
}
//# sourceMappingURL=parse-stl.js.map