"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — section placement and the lofted solid. Two
 *                     |                             | decisions carry the watertightness guarantee. First, the strip
 *                     |                             | is INDEXED: adjacent quads name the same vertex indices, so a
 *                     |                             | shared edge is shared by identity and no epsilon can open a
 *                     |                             | seam. Second, the caps fan from an appended centroid rather
 *                     |                             | than triangulating the ring, because a fan closes ANY simple
 *                     |                             | ring — including the concave trailing edge of an aerofoil,
 *                     |                             | where an ear-clip would have to be correct to avoid a hole.
 *                     |                             | Orientation is then decided by measurement, not by trusting the
 *                     |                             | caller to have wound the profile counter-clockwise.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The centroid fan was WRONG and entry 1's claim about it was
 *                     |                             | false. A fan closes any STAR-SHAPED ring, not any simple one: a
 *                     |                             | NACA section with more camber than thickness (6409 is legal
 *                     |                             | input) has a concave lower surface, and 16 of its 78 cap facets
 *                     |                             | came out wound backwards and overlapping their neighbours. No
 *                     |                             | check in this slice could see it — the edge census, the winding
 *                     |                             | census and Euler are all satisfied, and the signed volume
 *                     |                             | TELESCOPES to the correct total however the interior wedges
 *                     |                             | cancel — so an inside-out cap shipped as `valid: true` and the
 *                     |                             | slicer was the first thing to disagree. Caps are now ear-clipped
 *                     |                             | ({@link triangulateRing}), which emits only facets INSIDE the
 *                     |                             | ring. That also drops the two appended centroid vertices, so a
 *                     |                             | capped loft is now exactly `rings · perRing` vertices and
 *                     |                             | `2·perRing·(rings−1) + 2·(perRing−2)` facets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WELD_EPSILON = void 0;
exports.placeSection = placeSection;
exports.loftSections = loftSections;
const logger_1 = require("@/shared/logger");
const mesh_metrics_1 = require("./mesh-metrics");
const polygon_triangulate_1 = require("./polygon-triangulate");
const vector_math_1 = require("./vector-math");
const log = (0, logger_1.createChildLogger)({ module: 'shared/geometry/mesh-loft' });
/** @description Default distance at which a section's trailing point counts as a repeat. */
exports.DEFAULT_WELD_EPSILON = 1e-9;
/**
 * @description Map a 2-D profile into 3-space: scale about the pivot, rotate about the pivot,
 * then project onto the placement's axes and translate. This is the domain-free form of "scaled
 * by chord, twisted about the pitch axis, translated onto the pitch-axis line" — a rotor slice
 * supplies chord/twist/radius, a hull slice supplies beam/heel/station, and the arithmetic is the
 * same either way.
 * @param section - Profile in its own plane.
 * @param placement - Where and how the profile lands.
 * @returns The profile's points in 3-space, in input order.
 * @throws RangeError when the section is empty or an axis has zero length.
 */
function placeSection(section, placement) {
    if (section.points.length === 0)
        throw new RangeError('placeSection requires a non-empty section');
    const uAxis = placement.uAxis ?? { x: 1, y: 0, z: 0 };
    const vAxis = placement.vAxis ?? { x: 0, y: 1, z: 0 };
    if ((0, vector_math_1.vecLength)(uAxis) === 0 || (0, vector_math_1.vecLength)(vAxis) === 0) {
        throw new RangeError('placeSection requires non-degenerate u and v axes');
    }
    const scale = placement.scale ?? 1;
    const angle = placement.rotationRad ?? 0;
    const pivot = placement.pivot ?? { x: 0, y: 0 };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return section.points.map((point) => {
        const dx = (point.x - pivot.x) * scale;
        const dy = (point.y - pivot.y) * scale;
        const u = dx * cos - dy * sin;
        const v = dx * sin + dy * cos;
        return (0, vector_math_1.addVec)(placement.origin, (0, vector_math_1.addVec)((0, vector_math_1.scaleVec)(uAxis, u), (0, vector_math_1.scaleVec)(vAxis, v)));
    });
}
/**
 * @description Drop a trailing point that merely repeats the ring's first point. Profile tables
 * published with an explicit closing point are common, and keeping it would give every section a
 * zero-length edge — which becomes a zero-area facet in the strip and a slicer rejection later.
 * @param ring - Ring points.
 * @param epsilon - Distance under which the endpoints count as the same point.
 * @returns A ring with no repeated closing point.
 */
function dropRepeatedClose(ring, epsilon) {
    const points = ring.map((point) => ({ ...point }));
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length > 3 && (0, vector_math_1.vecLength)((0, vector_math_1.subVec)(last, first)) <= epsilon)
        points.pop();
    return points;
}
/**
 * @description Validate and normalise the input sections into rings of equal length.
 * @param sections - Sections in span order.
 * @param closeRing - Whether rings close back on themselves.
 * @param epsilon - Weld distance for a repeated closing point.
 * @returns Cleaned rings.
 * @throws RangeError when there are fewer than two sections, a section has fewer than three
 * points, or the sections disagree on point count (the strip has no meaning if they do).
 */
function normalizeRings(sections, closeRing, epsilon) {
    if (sections.length < 2) {
        throw new RangeError(`loftSections needs at least 2 sections, received ${sections.length}`);
    }
    const rings = sections.map((section, index) => {
        if (section.length < 3) {
            throw new RangeError(`Section ${index} has ${section.length} points; a loft section needs at least 3`);
        }
        return closeRing ? dropRepeatedClose(section, epsilon) : section.map((point) => ({ ...point }));
    });
    const expected = rings[0].length;
    rings.forEach((ring, index) => {
        if (ring.length !== expected) {
            throw new RangeError(`Section ${index} has ${ring.length} points but section 0 has ${expected}; a lofted strip needs matching point counts`);
        }
    });
    return rings;
}
/**
 * @description The ring's edge list as index pairs. Closing the ring here — rather than by
 * appending a duplicate point — is what keeps the seam a shared edge instead of a hairline crack.
 * @param count - Points in the ring.
 * @param closeRing - Whether to emit the wrap-around edge.
 * @returns Ordered `[from, to]` index pairs.
 */
function ringEdges(count, closeRing) {
    const edges = [];
    const limit = closeRing ? count : count - 1;
    for (let i = 0; i < limit; i += 1)
        edges.push([i, (i + 1) % count]);
    return edges;
}
/**
 * @description Emit the two facets of each quad between two rings. The split is fixed
 * (lower-left / upper-right) rather than shortest-diagonal: a consistent split keeps the seam
 * predictable across sections, and the diagonal choice cannot affect watertightness because both
 * facets are built from the same four shared indices.
 * @param triangles - Facet list to append to, mutated.
 * @param edges - Ring edge list.
 * @param baseA - Vertex offset of the lower ring.
 * @param baseB - Vertex offset of the upper ring.
 * @returns Nothing; `triangles` is extended in place.
 */
function appendStrip(triangles, edges, baseA, baseB) {
    for (const [i, next] of edges) {
        triangles.push([baseA + i, baseA + next, baseB + next]);
        triangles.push([baseA + i, baseB + next, baseB + i]);
    }
}
/**
 * @description Cap one end of the loft by fanning the ring from an appended centroid vertex. Kept
 * ONLY as the fallback for a ring {@link triangulateRing} refuses — a ring that crosses itself has
 * no correct triangulation at all, and a fan at least closes the surface so the failure surfaces as
 * a geometry the caller can look at rather than as a hole.
 * @param vertices - Vertex list, mutated — the centroid is appended.
 * @param triangles - Facet list, mutated.
 * @param ring - The ring being capped.
 * @param base - Vertex offset of the ring.
 * @param end - Which end; the start cap is wound the other way so both caps face outward.
 * @returns Nothing; both lists are extended in place.
 */
function appendCentroidFan(vertices, triangles, ring, base, end) {
    const centroid = ring.reduce((sum, point) => (0, vector_math_1.addVec)(sum, point), { x: 0, y: 0, z: 0 });
    const centroidIndex = vertices.length;
    vertices.push((0, vector_math_1.scaleVec)(centroid, 1 / ring.length));
    for (let i = 0; i < ring.length; i += 1) {
        const next = (i + 1) % ring.length;
        triangles.push(end === 'start' ? [centroidIndex, base + next, base + i] : [centroidIndex, base + i, base + next]);
    }
}
/**
 * @description Cap one end of the loft with an ear-clipped triangulation of its ring.
 *
 * {@link triangulateRing} winds its facets along the ring's own Newell normal, which is the same
 * direction the traversal order implies — so the END cap is emitted verbatim and the START cap is
 * reversed, and both then face away from the solid for either input handedness. Every facet lies
 * INSIDE the ring, which is the property a centroid fan silently loses on a concave profile.
 * @param vertices - Vertex list, mutated only when the ring cannot be ear-clipped.
 * @param triangles - Facet list, mutated.
 * @param ring - The ring being capped.
 * @param base - Vertex offset of the ring.
 * @param end - Which end; the start cap is wound the other way so both caps face outward.
 * @returns Nothing; the lists are extended in place.
 */
function appendCap(vertices, triangles, ring, base, end) {
    const capped = (0, polygon_triangulate_1.triangulateRing)(ring);
    if (!capped) {
        log.error({ points: ring.length, end }, 'cap ring is not a simple polygon — falling back to a centroid fan, whose facets may overlap');
        appendCentroidFan(vertices, triangles, ring, base, end);
        return;
    }
    for (const [a, b, c] of capped) {
        triangles.push(end === 'start' ? [base + a, base + c, base + b] : [base + a, base + b, base + c]);
    }
}
/**
 * @description Loft a series of placed sections into an indexed triangle mesh: a quad strip
 * between every adjacent pair of sections, split into two facets, plus optional end caps.
 *
 * With the defaults the result is a closed solid, and its orientation is MEASURED rather than
 * assumed — if the caller's profiles were wound clockwise the whole mesh comes out inside out, so
 * the signed volume is checked and the winding flipped when it is negative. That check is why a
 * caller does not have to know this slice's handedness convention to get a printable part.
 * @param sections - Sections in span order, each already placed in 3-space (see
 * {@link placeSection}). Every section must carry the same number of points.
 * @param options - Ring closure, capping and weld tolerance. See {@link LoftOptions}.
 * @returns The lofted mesh. Watertight when `closeRing`, `capStart` and `capEnd` all hold and the
 * input profiles are simple — check with {@link validateMesh} before exporting.
 * @throws RangeError on fewer than two sections, a section under three points, or mismatched
 * point counts between sections.
 */
function loftSections(sections, options = {}) {
    const closeRing = options.closeRing ?? true;
    const capStart = options.capStart ?? closeRing;
    const capEnd = options.capEnd ?? closeRing;
    const rings = normalizeRings(sections, closeRing, options.weldEpsilon ?? exports.DEFAULT_WELD_EPSILON);
    const perRing = rings[0].length;
    const edges = ringEdges(perRing, closeRing);
    const vertices = rings.flat();
    const triangles = [];
    for (let s = 0; s + 1 < rings.length; s += 1)
        appendStrip(triangles, edges, s * perRing, (s + 1) * perRing);
    const lastBase = (rings.length - 1) * perRing;
    if (capStart)
        appendCap(vertices, triangles, rings[0], 0, 'start');
    if (capEnd)
        appendCap(vertices, triangles, rings[rings.length - 1], lastBase, 'end');
    const built = { vertices, triangles };
    const closed = closeRing && capStart && capEnd;
    const inverted = closed && (0, mesh_metrics_1.meshVolume)(built) < 0;
    log.debug({ sections: rings.length, perRing, vertices: vertices.length, triangles: triangles.length, closed, inverted }, 'lofted sections into a triangle mesh');
    return inverted ? (0, mesh_metrics_1.flipWinding)(built) : built;
}
