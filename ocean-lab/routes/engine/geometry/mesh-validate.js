"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the printability gate. "Watertight" is decided
 *                     |                             | on INDEX identity, not on vertex proximity: two facets share an
 *                     |                             | edge when they name the same pair of indices, so the verdict is
 *                     |                             | exact and no tolerance can talk a hole into looking closed. The
 *                     |                             | four checks are deliberately independent — an edge census, a
 *                     |                             | directed-traversal check, an area check and Euler — because
 *                     |                             | each catches a failure the others miss: a doubled-back facet
 *                     |                             | passes the edge census, a mesh with a handle passes everything
 *                     |                             | except Euler, and a zero-area sliver passes all three topology
 *                     |                             | checks while still crashing a slicer's normal computation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The default area floor is now purely relative — see
 *                     |                             | {@link defaultAreaEpsilon}. It also states plainly what this
 *                     |                             | validator does NOT decide: every check here is TOPOLOGICAL or
 *                     |                             | per-facet, so it cannot see two facets that overlap in space
 *                     |                             | without sharing an edge. The signed-volume test is not a
 *                     |                             | substitute — the divergence sum telescopes, so locally inverted
 *                     |                             | facets cancel and the total stays right. That hole is closed at
 *                     |                             | the PRODUCER (mesh-loft's ear-clipped caps), not here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMesh = validateMesh;
const logger_1 = require("@/shared/logger");
const mesh_metrics_1 = require("./mesh-metrics");
const vector_math_1 = require("./vector-math");
const log = (0, logger_1.createChildLogger)({ module: 'shared/geometry/mesh-validate' });
/** @description Relative area floor: facets below `RELATIVE_AREA_FLOOR · diagonal²` are slivers. */
const RELATIVE_AREA_FLOOR = 1e-12;
/**
 * @description Census every undirected edge, recording how many facets use it and how many of
 * those traverse it in the low→high direction. Both numbers are needed: the count decides
 * watertightness, and the direction split decides winding consistency.
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
 * @description Indices of the zero-area facets. Collinear and coincident vertices both land here,
 * which is what we want: a slicer cannot derive a normal from either.
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
 * @description Default facet-area floor for a mesh: PURELY relative, `diagonal² · 1e-12`.
 *
 * The floor must carry no absolute term at all. An earlier form clamped the scale with
 * `Math.max(diagonal², 1)`, which is only inert for parts bigger than one unit — and every part
 * expressed in METRES (which is what `bladeToMesh` emits) has a diagonal well under 1, so the
 * clamp turned the threshold into an absolute 1e-12 and the same solid got opposite verdicts in
 * millimetres and in metres. Measured on a 150 mm blade with a 0.1 mm tip chord: 8 degenerate
 * facets in metres, 0 in millimetres, 476 in kilometres — three verdicts for one geometry.
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
 * @description Decide whether a mesh is a closed, consistently wound, outward-facing genus-0
 * solid — i.e. whether it will actually print.
 *
 * The Euler check is not redundant with the edge census: a mesh can be perfectly manifold and
 * still be a torus (χ = 0) or two disjoint shells (χ = 4). For a single lofted solid the only
 * acceptable answer is 2, and the caller gets the number rather than a boolean so a failure says
 * *how* it failed. Vertices are counted as REFERENCED vertices — an orphan vertex left in the
 * array is not part of the surface and must not be allowed to move χ.
 *
 * What it does NOT decide: whether facets INTERSECT each other. Every check here is topological or
 * per-facet, and `meshVolume`'s divergence sum telescopes, so a patch of locally inverted,
 * overlapping facets cancels out and leaves both χ and the volume correct. `valid: true` therefore
 * means "closed, consistently wound, outward on the whole, no slivers, genus 0" — not "embeds
 * without self-intersection". Producing a non-self-intersecting surface is the LOFT's job.
 * @param mesh - Mesh to check.
 * @param options - Tolerances; see {@link MeshValidationOptions}.
 * @returns The full measurement set. See {@link MeshValidation}.
 * @throws RangeError when a facet references a vertex that does not exist — that is a malformed
 * mesh rather than a quality verdict, so it fails loudly instead of reporting `valid: false`.
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
        // Only a properly shared edge can be judged: a boundary edge has nothing to disagree with,
        // and a non-manifold edge is already reported on its own line.
        if (use.count === 2 && use.forward !== 1)
            consistentWinding = false;
    }
    const openEdges = boundaryEdges + nonManifoldEdges;
    const watertight = mesh.triangles.length > 0 && openEdges === 0;
    const eulerCharacteristic = referenced.size - census.size + mesh.triangles.length;
    const outwardFacing = watertight && consistentWinding && (0, mesh_metrics_1.meshVolume)(mesh) > 0;
    const verdict = {
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
    log.debug({ ...verdict, degenerateTriangles: degenerateTriangles.length }, 'validated mesh topology');
    return verdict;
}
