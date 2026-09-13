"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Vendored from the ocean-lab geometry slice: the printability
 *                     |                             | gate. "Watertight" is decided on INDEX identity, not vertex
 *                     |                             | proximity, so the verdict is exact. Four independent checks —
 *                     |                             | edge census, directed traversal, area, Euler — because each
 *                     |                             | catches a failure the others miss. The logger import was
 *                     |                             | dropped: this engine is pure so plain `node --test` can load
 *                     |                             | the compiled module with no framework resolution.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMesh = validateMesh;
const mesh_metrics_1 = require("./mesh-metrics");
const vector_math_1 = require("./vector-math");
/** @description Relative area floor: facets below `RELATIVE_AREA_FLOOR · diagonal²` are slivers. */
const RELATIVE_AREA_FLOOR = 1e-12;
/**
 * @description Census every undirected edge: how many facets use it, and how many traverse it
 * low→high. The count decides watertightness; the direction split decides winding consistency.
 * @param mesh - Mesh to census.
 * @returns Map keyed `low:high` over vertex indices.
 * @throws RangeError when a facet references a vertex that does not exist.
 */
function buildEdgeCensus(mesh) {
    const census = new Map();
    for (let i = 0; i < mesh.triangles.length; i += 1) {
        const triangle = mesh.triangles[i];
        (0, vector_math_1.resolveTriangle)(mesh, triangle, i);
        for (let e = 0; e < 3; e += 1) {
            const from = triangle[e];
            const to = triangle[(e + 1) % 3];
            const key = from < to ? `${from}:${to}` : `${to}:${from}`;
            const use = census.get(key) ?? { count: 0, forward: 0 };
            use.count += 1;
            if (from <= to)
                use.forward += 1;
            census.set(key, use);
        }
    }
    return census;
}
/**
 * @description Indices of the zero-area facets.
 * @param mesh - Mesh to scan.
 * @param areaEpsilon - Area at or below which a facet counts as degenerate.
 * @returns Facet indices, ascending.
 * @throws RangeError when a facet references a vertex that does not exist.
 */
function findDegenerate(mesh, areaEpsilon) {
    const found = [];
    for (let i = 0; i < mesh.triangles.length; i += 1) {
        const [a, b, c] = (0, vector_math_1.resolveTriangle)(mesh, mesh.triangles[i], i);
        if ((0, vector_math_1.triangleArea)(a, b, c) <= areaEpsilon)
            found.push(i);
    }
    return found;
}
/**
 * @description Default facet-area floor for a mesh: purely relative, `diagonal² · 1e-12`, so the
 * same solid gets the same verdict in millimetres and in metres.
 * @param mesh - Mesh to size.
 * @returns The area floor, in the mesh's squared units.
 */
function defaultAreaEpsilon(mesh) {
    if (mesh.vertices.length === 0)
        return 0;
    const diagonal = (0, mesh_metrics_1.meshDiagonal)(mesh);
    return diagonal * diagonal * RELATIVE_AREA_FLOOR;
}
/**
 * @description Decide whether a mesh is a closed, consistently wound, outward-facing solid — i.e.
 * whether it will actually print. The Euler number is returned rather than a boolean so a failure
 * says HOW it failed (χ = 0 is a torus, χ = 4 is two shells). What it does NOT decide: whether
 * facets INTERSECT each other — every check here is topological or per-facet.
 * @param mesh - Mesh to check.
 * @param options - Tolerances; see {@link MeshValidationOptions}.
 * @returns The full measurement set. See {@link MeshValidation}.
 * @throws RangeError when a facet references a vertex that does not exist.
 */
function validateMesh(mesh, options = {}) {
    const areaEpsilon = options.areaEpsilon ?? defaultAreaEpsilon(mesh);
    const census = buildEdgeCensus(mesh);
    const degenerateTriangles = findDegenerate(mesh, areaEpsilon);
    const referenced = new Set();
    for (const triangle of mesh.triangles) {
        for (const index of triangle)
            referenced.add(index);
    }
    let boundaryEdges = 0;
    let nonManifoldEdges = 0;
    let consistentWinding = mesh.triangles.length > 0;
    for (const use of census.values()) {
        if (use.count === 1)
            boundaryEdges += 1;
        else if (use.count > 2)
            nonManifoldEdges += 1;
        if (use.count === 2 && use.forward !== 1)
            consistentWinding = false;
    }
    const openEdges = boundaryEdges + nonManifoldEdges;
    const watertight = mesh.triangles.length > 0 && openEdges === 0;
    const eulerCharacteristic = referenced.size - census.size + mesh.triangles.length;
    const outwardFacing = watertight && consistentWinding && (0, mesh_metrics_1.meshVolume)(mesh) > 0;
    return {
        watertight,
        openEdges,
        degenerate: degenerateTriangles.length,
        eulerCharacteristic,
        consistentWinding,
        boundaryEdges,
        nonManifoldEdges,
        degenerateTriangles,
        outwardFacing,
        valid: watertight &&
            consistentWinding &&
            outwardFacing &&
            degenerateTriangles.length === 0 &&
            eulerCharacteristic === 2,
    };
}
//# sourceMappingURL=mesh-validate.js.map