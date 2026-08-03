"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the vector primitives the loft, the validator
 *                     |                             | and the exporters all share. Kept as free functions over plain
 *                     |                             | objects rather than a Vector class: every consumer here is a
 *                     |                             | pure transform, and a class would only add allocation and an
 *                     |                             | `this` to get wrong inside a triangle loop.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZERO_VEC3 = void 0;
exports.vec3 = vec3;
exports.addVec = addVec;
exports.subVec = subVec;
exports.scaleVec = scaleVec;
exports.dotVec = dotVec;
exports.crossVec = crossVec;
exports.vecLength = vecLength;
exports.normalizeVec = normalizeVec;
exports.triangleCross = triangleCross;
exports.triangleArea = triangleArea;
exports.triangleNormal = triangleNormal;
exports.resolveTriangle = resolveTriangle;
/** @description The additive identity, handed back for degenerate normals. Frozen — it escapes. */
exports.ZERO_VEC3 = Object.freeze({ x: 0, y: 0, z: 0 });
/**
 * @description Construct a vector. A one-line constructor exists so call sites read as geometry
 * (`vec3(0, 0, 1)`) rather than as object literals buried in argument lists.
 * @param x - Cartesian X.
 * @param y - Cartesian Y.
 * @param z - Cartesian Z.
 * @returns A new vector.
 */
function vec3(x, y, z) {
    return { x, y, z };
}
/**
 * @description Component-wise sum.
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns A new vector, `a + b`.
 */
function addVec(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
/**
 * @description Component-wise difference — the edge vector between two points.
 * @param a - Head.
 * @param b - Tail.
 * @returns A new vector, `a − b`.
 */
function subVec(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
/**
 * @description Uniform scale.
 * @param a - Vector to scale.
 * @param s - Scalar factor.
 * @returns A new vector, `a · s`.
 */
function scaleVec(a, s) {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}
/**
 * @description Dot product.
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The scalar projection product.
 */
function dotVec(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
/**
 * @description Cross product, right-handed. This is the single place the winding convention is
 * realised: every outward-normal and signed-volume claim in this slice bottoms out here.
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `a × b`, whose length is the area of the parallelogram they span.
 */
function crossVec(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}
/**
 * @description Euclidean length.
 * @param a - Vector to measure.
 * @returns `|a|`.
 */
function vecLength(a) {
    return Math.hypot(a.x, a.y, a.z);
}
/**
 * @description Unit vector, or the zero vector when the input has no length. Returning zero
 * rather than throwing or emitting NaN is deliberate: a zero normal is the STL convention for
 * "derive it from the winding", so a degenerate facet still writes a legal file instead of
 * poisoning the buffer with NaN.
 * @param a - Vector to normalise.
 * @returns A unit-length copy, or {@link ZERO_VEC3} when `|a| = 0`.
 */
function normalizeVec(a) {
    const length = vecLength(a);
    if (length === 0)
        return { ...exports.ZERO_VEC3 };
    return { x: a.x / length, y: a.y / length, z: a.z / length };
}
/**
 * @description The un-normalised facet normal `(b − a) × (c − a)`. Callers that only need area or
 * only need direction take this once and avoid a redundant square root.
 * @param a - First vertex.
 * @param b - Second vertex.
 * @param c - Third vertex.
 * @returns A vector normal to the facet whose length is twice the facet area.
 */
function triangleCross(a, b, c) {
    return crossVec(subVec(b, a), subVec(c, a));
}
/**
 * @description Facet area.
 * @param a - First vertex.
 * @param b - Second vertex.
 * @param c - Third vertex.
 * @returns Area, always non-negative. Exactly 0 for collinear or coincident vertices.
 */
function triangleArea(a, b, c) {
    return vecLength(triangleCross(a, b, c)) / 2;
}
/**
 * @description Outward unit normal implied by the vertex order (right-hand rule).
 * @param a - First vertex.
 * @param b - Second vertex.
 * @param c - Third vertex.
 * @returns The unit normal, or {@link ZERO_VEC3} for a degenerate facet.
 */
function triangleNormal(a, b, c) {
    return normalizeVec(triangleCross(a, b, c));
}
/**
 * @description Resolve a facet's index triple to its three positions, checking the indices as it
 * goes. Every consumer in this slice goes through here so that an out-of-range index fails at the
 * point of the bad data instead of surfacing as `undefined.x` three call frames later.
 * @param mesh - Mesh to read.
 * @param triangle - Index triple.
 * @param at - Facet index, for the error message.
 * @returns The three vertex positions in winding order.
 * @throws RangeError when any index falls outside the vertex array.
 */
function resolveTriangle(mesh, triangle, at) {
    const pick = (index) => {
        if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) {
            throw new RangeError(`Triangle ${at} references vertex ${index}, outside the ${mesh.vertices.length}-vertex array`);
        }
        return mesh.vertices[index];
    };
    return [pick(triangle[0]), pick(triangle[1]), pick(triangle[2])];
}
