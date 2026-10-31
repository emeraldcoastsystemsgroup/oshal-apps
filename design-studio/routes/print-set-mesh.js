"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: an STL file read back and checked the way
 *                     |                             | the spider's hand-written print set checked its thirteen files
 *                     |                             | (embodied/scripts/hexapod-prints.mjs), generalised to any part:
 *                     |                             | binary or ASCII STL parsed into welded vertices and triangles,
 *                     |                             | then watertight means every edge is shared by exactly two
 *                     |                             | triangles and no triangle is degenerate. The numbers here are
 *                     |                             | the mesh's own; nothing is assumed about the part.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRIANGLES = void 0;
exports.parseStl = parseStl;
exports.meshCheck = meshCheck;
exports.meshFault = meshFault;
exports.sha256Hex = sha256Hex;
const node_crypto_1 = require("node:crypto");
const BINARY_HEADER = 80;
const FACET_BYTES = 50;
/** The most triangles one part may carry; a print of a hand-held part is far under it. */
exports.MAX_TRIANGLES = 4_000_000;
/** @description Is this buffer an ASCII STL (a `solid` header followed by facet text)? */
function isAscii(buf) {
    return buf.subarray(0, 5).toString('latin1') === 'solid' && buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1').includes('facet');
}
/** The vertices of an ASCII STL, three per facet. */
function asciiFacets(buf) {
    const v = [...buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const facets = [];
    for (let i = 0; i + 2 < v.length; i += 3)
        facets.push([v[i], v[i + 1], v[i + 2]]);
    return facets;
}
/** The vertices of a binary STL; refuses a count the bytes cannot hold. */
function binaryFacets(buf) {
    if (buf.length < BINARY_HEADER + 4)
        throw new RangeError('not an STL: shorter than a binary header');
    const count = buf.readUInt32LE(BINARY_HEADER);
    if (count > exports.MAX_TRIANGLES)
        throw new RangeError(`not a printable STL: ${count} triangles is over the ${exports.MAX_TRIANGLES} cap`);
    if (buf.length < BINARY_HEADER + 4 + count * FACET_BYTES)
        throw new RangeError(`not a valid binary STL: ${count} triangles declared, ${buf.length} bytes present`);
    const facets = [];
    for (let i = 0; i < count; i += 1) {
        const o = BINARY_HEADER + 4 + i * FACET_BYTES + 12;
        facets.push([0, 1, 2].map((k) => [buf.readFloatLE(o + k * 12), buf.readFloatLE(o + k * 12 + 4), buf.readFloatLE(o + k * 12 + 8)]));
    }
    return facets;
}
/**
 * @description Parse a binary or ASCII STL into welded vertices and triangles.
 * @param buf - The file bytes.
 * @returns The mesh.
 * @throws RangeError when the bytes are not an STL.
 */
function parseStl(buf) {
    const facets = isAscii(buf) ? asciiFacets(buf) : binaryFacets(buf);
    if (!facets.length)
        throw new RangeError('not a printable STL: no triangles');
    const index = new Map();
    let count = 0;
    const id = (p) => {
        if (!p.every(Number.isFinite))
            throw new RangeError('not a valid STL: a vertex is not a finite number');
        const key = p.join(',');
        const known = index.get(key);
        if (known !== undefined)
            return known;
        index.set(key, count);
        count += 1;
        return count - 1;
    };
    const triangles = facets.map((f) => f.map(id));
    return { vertexCount: count, triangles };
}
/**
 * @description Watertight: every edge shared by exactly two triangles, no degenerate triangle.
 * @param mesh - A parsed mesh.
 * @returns The counts and the verdict.
 */
function meshCheck(mesh) {
    const edges = new Map();
    let degenerate = 0;
    for (const [a, b, c] of mesh.triangles) {
        if (a === b || b === c || a === c) {
            degenerate += 1;
            continue;
        }
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const key = u < v ? `${u}-${v}` : `${v}-${u}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    }
    let open = 0;
    let nonManifold = 0;
    for (const n of edges.values()) {
        if (n === 1)
            open += 1;
        else if (n > 2)
            nonManifold += 1;
    }
    return { open, nonManifold, degenerate, watertight: open === 0 && nonManifold === 0 && degenerate === 0, triangles: mesh.triangles.length };
}
/**
 * @description The one line a sheet or a refusal says about a mesh that is not watertight.
 * @param check - The check.
 * @returns Why, in the mesh's numbers.
 */
function meshFault(check) {
    const parts = [];
    if (check.open)
        parts.push(`${check.open} open edge${check.open === 1 ? '' : 's'}`);
    if (check.nonManifold)
        parts.push(`${check.nonManifold} non-manifold edge${check.nonManifold === 1 ? '' : 's'}`);
    if (check.degenerate)
        parts.push(`${check.degenerate} degenerate triangle${check.degenerate === 1 ? '' : 's'}`);
    return `the exported STL is not watertight: ${parts.join(', ')}`;
}
/**
 * @description The sha256 of some bytes, hex.
 * @param bytes - The bytes.
 * @returns 64 hex characters.
 */
function sha256Hex(bytes) {
    return (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex');
}
//# sourceMappingURL=print-set-mesh.js.map