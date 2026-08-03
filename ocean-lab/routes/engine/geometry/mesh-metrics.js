"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — bounds, volume, area and facet normals. Volume
 *                     |                             | is SIGNED on purpose: the divergence-theorem sum is the cheapest
 *                     |                             | orientation test there is, so the loft uses its sign to decide
 *                     |                             | whether the caller handed it clockwise rings, and the validator
 *                     |                             | uses it to decide whether the normals actually point out. An
 *                     |                             | absolute value here would have thrown that signal away.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.meshBounds = meshBounds;
exports.meshDiagonal = meshDiagonal;
exports.meshVolume = meshVolume;
exports.meshSurfaceArea = meshSurfaceArea;
exports.recomputeNormals = recomputeNormals;
exports.flipWinding = flipWinding;
const vector_math_1 = require("./vector-math");
/**
 * @description Axis-aligned bounds of the vertex cloud.
 * @param mesh - Mesh to measure.
 * @returns Min, max, size and centre.
 * @throws RangeError when the mesh has no vertices — an empty box has no meaningful centre, and
 * returning zeros would let an empty export sail through a print-bed check.
 */
function meshBounds(mesh) {
    if (mesh.vertices.length === 0) {
        throw new RangeError('meshBounds requires at least one vertex');
    }
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const vertex of mesh.vertices) {
        min.x = Math.min(min.x, vertex.x);
        min.y = Math.min(min.y, vertex.y);
        min.z = Math.min(min.z, vertex.z);
        max.x = Math.max(max.x, vertex.x);
        max.y = Math.max(max.y, vertex.y);
        max.z = Math.max(max.z, vertex.z);
    }
    return {
        min,
        max,
        size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
        center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    };
}
/**
 * @description Length of the bounding-box diagonal — the one scalar that says "how big is this
 * part", used to scale tolerances so a 2 mm boss and a 2 m blade get the same verdict.
 * @param mesh - Mesh to measure.
 * @returns The diagonal length, or 0 for a single-point mesh.
 * @throws RangeError when the mesh has no vertices.
 */
function meshDiagonal(mesh) {
    const { size } = meshBounds(mesh);
    return Math.hypot(size.x, size.y, size.z);
}
/**
 * @description Signed volume by the divergence theorem: ⅙ Σ a · (b × c) over the facets. Valid
 * only for a closed surface — on an open one the missing facets simply do not contribute and the
 * result is meaningless, which is why callers should check {@link validateMesh} first.
 * @param mesh - Mesh to measure.
 * @returns Volume in the mesh's cubed units. Positive when the winding faces outward, negative
 * when the solid is inside out.
 * @throws RangeError when a facet references a vertex that does not exist.
 */
function meshVolume(mesh) {
    let total = 0;
    for (let i = 0; i < mesh.triangles.length; i += 1) {
        const [a, b, c] = (0, vector_math_1.resolveTriangle)(mesh, mesh.triangles[i], i);
        total += (0, vector_math_1.dotVec)(a, (0, vector_math_1.crossVec)(b, c));
    }
    return total / 6;
}
/**
 * @description Total facet area.
 * @param mesh - Mesh to measure.
 * @returns Surface area in the mesh's squared units.
 * @throws RangeError when a facet references a vertex that does not exist.
 */
function meshSurfaceArea(mesh) {
    let total = 0;
    for (let i = 0; i < mesh.triangles.length; i += 1) {
        const [a, b, c] = (0, vector_math_1.resolveTriangle)(mesh, mesh.triangles[i], i);
        total += (0, vector_math_1.triangleArea)(a, b, c);
    }
    return total;
}
/**
 * @description Per-facet unit normals derived from the winding. Nothing is stored on the mesh —
 * normals are a FUNCTION of the winding, and a cached copy is one refactor away from disagreeing
 * with the geometry it claims to describe. Degenerate facets yield the zero vector, which is the
 * STL convention for "recover it from the vertex order".
 * @param mesh - Mesh to read.
 * @returns One unit normal per facet, in facet order.
 * @throws RangeError when a facet references a vertex that does not exist.
 */
function recomputeNormals(mesh) {
    return mesh.triangles.map((triangle, index) => {
        const [a, b, c] = (0, vector_math_1.resolveTriangle)(mesh, triangle, index);
        return (0, vector_math_1.triangleNormal)(a, b, c);
    });
}
/**
 * @description Reverse every facet's winding, flipping the solid inside out. Used by the loft when
 * the caller's sections were wound the other way; also the one-line fix when a third-party mesh
 * imports inverted.
 * @param mesh - Mesh to flip.
 * @returns A new mesh sharing the vertex array's values with reversed facet order.
 */
function flipWinding(mesh) {
    return {
        vertices: mesh.vertices.map((vertex) => ({ ...vertex })),
        triangles: mesh.triangles.map(([a, b, c]) => [a, c, b]),
    };
}
