"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — ear-clip triangulation of a simple ring, and
 *                     |                             | the reason the loft's caps stopped fanning from a centroid. A
 *                     |                             | centroid fan is only valid for a ring that is STAR-SHAPED about
 *                     |                             | that centroid; a NACA section whose camber exceeds its thickness
 *                     |                             | has a concave lower surface, the centroid falls outside the
 *                     |                             | region those wedges are supposed to cover, and the fan emits
 *                     |                             | facets wound backwards and overlapping their neighbours. None
 *                     |                             | of the topology checks see it: every edge is still shared
 *                     |                             | exactly twice, the winding is still consistent, and the signed
 *                     |                             | volume TELESCOPES to the right total no matter how the interior
 *                     |                             | wedges cancel — so validateMesh calls an inside-out cap valid
 *                     |                             | and the slicer is the first thing to disagree. Ear clipping
 *                     |                             | emits only triangles that lie INSIDE the ring, which is the
 *                     |                             | property the fan never had.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ringNormal = ringNormal;
exports.triangulateRing = triangulateRing;
const logger_1 = require("@/shared/logger");
const vector_math_1 = require("./vector-math");
const log = (0, logger_1.createChildLogger)({ module: 'shared/geometry/polygon-triangulate' });
/** @description Relative floor on a candidate ear's area, scaled by the ring's own extent. */
const EAR_AREA_FLOOR = 1e-15;
/**
 * @description Newell's normal for a ring: the area-weighted normal of its best-fit plane, with a
 * direction fixed by the traversal order (right-hand rule). Newell rather than a cross product of
 * the first three points because three consecutive points of an aerofoil outline are very nearly
 * collinear — their cross product is numerical noise, while the whole-ring sum is dominated by the
 * ring's real extent.
 * @param ring - Ring points in traversal order.
 * @returns The un-normalised plane normal; its length is twice the ring's planar area.
 */
function ringNormal(ring) {
    const normal = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        normal.x += (a.y - b.y) * (a.z + b.z);
        normal.y += (a.z - b.z) * (a.x + b.x);
        normal.z += (a.x - b.x) * (a.y + b.y);
    }
    return normal;
}
/**
 * @description Project a ring onto its own plane so it can be triangulated in 2-D.
 *
 * The basis is built from the axis LEAST aligned with the normal, which is what keeps the
 * projection well-conditioned for a ring in any orientation — picking a fixed helper axis produces
 * a near-zero cross product exactly when the ring happens to lie in that axis's plane.
 * @param ring - Ring points in traversal order.
 * @returns The planar points and the projected ring's `2 · area`.
 * @throws RangeError when the ring encloses no measurable area — either its points are collinear,
 * or it crosses itself symmetrically enough that its signed areas cancel. Both are rings with no
 * interior to triangulate, and a cap over either would be zero-area facets.
 */
function projectRing(ring) {
    const raw = ringNormal(ring);
    const twiceArea = (0, vector_math_1.vecLength)(raw);
    if (twiceArea === 0) {
        throw new RangeError('Cannot triangulate a ring that encloses no area — its points are collinear or it self-cancels');
    }
    const normal = (0, vector_math_1.normalizeVec)(raw);
    const helper = Math.abs(normal.x) <= Math.abs(normal.y) && Math.abs(normal.x) <= Math.abs(normal.z)
        ? { x: 1, y: 0, z: 0 }
        : Math.abs(normal.y) <= Math.abs(normal.z)
            ? { x: 0, y: 1, z: 0 }
            : { x: 0, y: 0, z: 1 };
    const uAxis = (0, vector_math_1.normalizeVec)((0, vector_math_1.crossVec)(helper, normal));
    const vAxis = (0, vector_math_1.crossVec)(normal, uAxis);
    const origin = ring[0];
    const points = ring.map((point) => {
        const local = (0, vector_math_1.subVec)(point, origin);
        return { x: (0, vector_math_1.dotVec)(local, uAxis), y: (0, vector_math_1.dotVec)(local, vAxis) };
    });
    return { points, twiceArea };
}
/**
 * @description Twice the signed area of a 2-D triangle. Positive when `a → b → c` turns
 * counter-clockwise.
 * @param a - First corner.
 * @param b - Second corner.
 * @param c - Third corner.
 * @returns `2 · signed area`.
 */
function cross2(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
/**
 * @description Whether a point lies inside (or on) a triangle, by the sign of the three edge
 * cross products. `>= 0` on all three rather than `> 0`: a vertex sitting exactly ON a candidate
 * ear's edge still blocks that ear, because clipping it would emit a facet through another vertex
 * and leave a T-junction.
 * @param point - Point to test.
 * @param a - First corner of a counter-clockwise triangle.
 * @param b - Second corner.
 * @param c - Third corner.
 * @returns True when the point is inside or on the triangle.
 */
function insideTriangle(point, a, b, c) {
    return cross2(a, b, point) >= 0 && cross2(b, c, point) >= 0 && cross2(c, a, point) >= 0;
}
/**
 * @description The convex corners of the remaining polygon, LARGEST first.
 *
 * Order is the quality knob and it is not cosmetic. Clipping the first convex corner found walks
 * the ring and shaves the sharpest features first, which on an aerofoil means the two edges either
 * side of the trailing edge become a triangle of their own — a facet with an area around 1e-14 m²
 * on a 2 mm chord, i.e. below float32 and exactly the sliver a slicer drops into a hole. Taking the
 * BIGGEST ear first defers those corners until their neighbours are far away, so the sharp corner
 * ends up inside a facet with real area instead of being one.
 * @param points - Planar ring points, counter-clockwise.
 * @param remaining - Indices still in the polygon, in order.
 * @param areaFloor - Minimum `2 · area` for a corner to count as convex.
 * @returns Positions within `remaining`, ordered by descending corner area.
 */
function convexCandidates(points, remaining, areaFloor) {
    const count = remaining.length;
    const scored = [];
    for (let at = 0; at < count; at += 1) {
        const area = cross2(points[remaining[(at - 1 + count) % count]], points[remaining[at]], points[remaining[(at + 1) % count]]);
        if (area > areaFloor)
            scored.push({ at, area });
    }
    scored.sort((a, b) => b.area - a.area);
    return scored.map((entry) => entry.at);
}
/**
 * @description Whether a convex corner is a true ear — no other remaining vertex inside it.
 * @param points - Planar ring points, counter-clockwise.
 * @param remaining - Indices still in the polygon, in order.
 * @param at - Position within `remaining` of the candidate.
 * @returns True when the corner can be clipped.
 */
function isClippable(points, remaining, at) {
    const count = remaining.length;
    const before = (at - 1 + count) % count;
    const after = (at + 1) % count;
    const prev = points[remaining[before]];
    const here = points[remaining[at]];
    const next = points[remaining[after]];
    for (let i = 0; i < count; i += 1) {
        if (i === at || i === before || i === after)
            continue;
        if (insideTriangle(points[remaining[i]], prev, here, next))
            return false;
    }
    return true;
}
/**
 * @description Clip ears off a counter-clockwise planar polygon until three points remain, taking
 * the largest available ear each time.
 * @param points - Planar ring points, counter-clockwise.
 * @param areaFloor - Minimum `2 · area` for a candidate to count as convex.
 * @returns Index triples into `points`, counter-clockwise, or null when no convex corner is
 * clippable (which means the ring is not simple — it crosses itself — and no ear-clip
 * triangulation of it exists).
 */
function clipEars(points, areaFloor) {
    const remaining = points.map((_, index) => index);
    const triangles = [];
    while (remaining.length > 3) {
        const count = remaining.length;
        const picked = convexCandidates(points, remaining, areaFloor).find((at) => isClippable(points, remaining, at));
        if (picked === undefined)
            return null;
        triangles.push([
            remaining[(picked - 1 + count) % count],
            remaining[picked],
            remaining[(picked + 1) % count],
        ]);
        remaining.splice(picked, 1);
    }
    triangles.push([remaining[0], remaining[1], remaining[2]]);
    return triangles;
}
/**
 * @description Triangulate a simple ring by ear clipping, in the ring's own plane.
 *
 * Every emitted triangle lies inside the ring and is wound so that its normal points along the
 * ring's Newell normal — which is what makes this usable as a cap without a second orientation
 * pass. That INSIDE property is the whole point: a centroid fan also covers a convex ring exactly,
 * but on a concave one it emits wedges that spill outside the region and cancel against each other,
 * and no edge census or signed-volume check can see that happen.
 * The guarantees hold for a SIMPLE ring. A ring that crosses itself has no correct triangulation
 * at all: this will either run out of clippable corners and return null, or return a covering of
 * the shape's own self-overlapping interior. Neither is a cap anyone should print, which is why the
 * caller logs before it uses one.
 * @param ring - Ring points in traversal order, not repeating the first point at the end.
 * @returns Index triples into `ring`, or null when no convex corner is clippable — reachable only
 * on a non-simple ring, and left to the caller to decide about.
 * @throws RangeError when the ring has fewer than three points, or encloses no area at all
 * (collinear points, or a self-crossing whose signed areas cancel exactly).
 */
function triangulateRing(ring) {
    if (ring.length < 3) {
        throw new RangeError(`triangulateRing needs at least 3 points, received ${ring.length}`);
    }
    // The projection basis is built FROM the Newell normal, so the ring always projects
    // counter-clockwise and the shoelace sum of the projection is exactly that normal's length.
    const plane = projectRing(ring);
    const triangles = clipEars(plane.points, plane.twiceArea * EAR_AREA_FLOOR);
    if (!triangles) {
        log.error({ points: ring.length }, 'ear clipping found no ear — the ring is not a simple polygon');
        return null;
    }
    log.debug({ points: ring.length, triangles: triangles.length }, 'triangulated a ring by ear clipping');
    return triangles;
}
