"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — Douglas–Peucker for a CLOSED polygon
 *                     |                             | (split at the vertex farthest from the first, simplify the
 *                     |                             | two open chains, rejoin), used to turn a voxel-step outline
 *                     |                             | into a CAD-sized polyline without moving any vertex further
 *                     |                             | than the tolerance. Deterministic: no randomness, ties break
 *                     |                             | on the lowest index.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.simplifyPolygon = simplifyPolygon;
exports.simplifyToBudget = simplifyToBudget;
/** Perpendicular distance from `p` to the segment a–b (distance to the nearer end for a degenerate segment). */
function segmentDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0)
        return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Douglas–Peucker on an OPEN chain; both end points are always kept. */
function simplifyChain(points, epsilon) {
    if (points.length <= 2)
        return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop();
        let best = -1, bestDist = epsilon;
        for (let i = s + 1; i < e; i += 1) {
            const d = segmentDistance(points[i], points[s], points[e]);
            if (d > bestDist) {
                bestDist = d;
                best = i;
            }
        }
        if (best >= 0) {
            keep[best] = 1;
            stack.push([s, best], [best, e]);
        }
    }
    return points.filter((_, i) => keep[i] === 1);
}
/**
 * @description Simplify a closed polygon so no removed vertex lies further than `epsilon` from the
 * simplified outline. Fewer than four vertices are returned unchanged.
 * @param loop - Closed loop (the last vertex connects to the first).
 * @param epsilon - Tolerance in the loop's units.
 * @returns The simplified closed loop.
 */
function simplifyPolygon(loop, epsilon) {
    if (loop.length < 4 || !(epsilon > 0))
        return loop.slice();
    let far = 0, farDist = -1;
    for (let i = 1; i < loop.length; i += 1) {
        const d = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y);
        if (d > farDist) {
            farDist = d;
            far = i;
        }
    }
    const first = simplifyChain(loop.slice(0, far + 1), epsilon);
    const second = simplifyChain([...loop.slice(far), loop[0]], epsilon);
    return [...first, ...second.slice(1, -1)];
}
/**
 * @description Simplify until the loop has at most `maxPoints` vertices, raising the tolerance
 * geometrically from `epsilon`. The tolerance actually used is returned with the loop.
 * @param loop - Closed loop.
 * @param epsilon - Starting tolerance.
 * @param maxPoints - Vertex cap (≥ 3).
 * @returns The loop and the tolerance that produced it.
 */
function simplifyToBudget(loop, epsilon, maxPoints) {
    let tolerance = epsilon;
    let out = simplifyPolygon(loop, tolerance);
    for (let round = 0; out.length > Math.max(3, maxPoints) && round < 40; round += 1) {
        tolerance *= 1.5;
        out = simplifyPolygon(loop, tolerance);
    }
    return { loop: out, epsilon: tolerance };
}
//# sourceMappingURL=simplify.js.map