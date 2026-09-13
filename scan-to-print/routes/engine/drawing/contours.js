"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — exact outline tracing for a binary mask. The
 *                     |                             | boundary of a pixel set is the set of pixel EDGES that separate
 *                     |                             | a set pixel from an unset one; emitting those edges with the
 *                     |                             | object always on the same side and chaining them head to tail
 *                     |                             | yields closed loops with no approximation and no tolerance.
 *                     |                             | Outer loops and holes come out with opposite orientation, so
 *                     |                             | an SVG even-odd fill renders them correctly without any
 *                     |                             | containment test. Collinear runs are merged afterwards so a
 *                     |                             | 100-pixel straight edge is two points, not a hundred.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.traceContours = traceContours;
exports.loopsToPath = loopsToPath;
const raster_types_1 = require("../raster/raster-types");
/** @description Map key for a corner point. */
const keyOf = (p) => `${p.x},${p.y}`;
/**
 * @description Emit every boundary edge of the mask, each traversing its pixel clockwise in
 * screen coordinates (y down), so the object is always on the right of travel.
 * @param mask - Input mask.
 * @returns The edges, unordered.
 */
function boundaryEdges(mask) {
    const edges = [];
    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            if ((0, raster_types_1.maskAt)(mask, x, y) === 0)
                continue;
            if ((0, raster_types_1.maskAt)(mask, x, y - 1) === 0)
                edges.push({ from: { x, y }, to: { x: x + 1, y }, used: false });
            if ((0, raster_types_1.maskAt)(mask, x + 1, y) === 0)
                edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 }, used: false });
            if ((0, raster_types_1.maskAt)(mask, x, y + 1) === 0)
                edges.push({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 }, used: false });
            if ((0, raster_types_1.maskAt)(mask, x - 1, y) === 0)
                edges.push({ from: { x, y: y + 1 }, to: { x, y }, used: false });
        }
    }
    return edges;
}
/** @description Cross product sign of two directions — positive is a right turn in screen coordinates. */
function turn(a, b) {
    return a.x * b.y - a.y * b.x;
}
/**
 * @description Choose the next edge out of a corner. At a saddle (two diagonal pixels touching)
 * four edges meet; preferring the sharpest right turn keeps the two blobs as separate loops.
 * @param candidates - Unused edges leaving the corner.
 * @param heading - Direction of the edge just walked.
 * @returns The chosen edge.
 */
function pickNext(candidates, heading) {
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const edge of candidates) {
        const dir = { x: edge.to.x - edge.from.x, y: edge.to.y - edge.from.y };
        const score = turn(heading, dir) - (dir.x === -heading.x && dir.y === -heading.y ? 10 : 0);
        if (score > bestScore) {
            bestScore = score;
            best = edge;
        }
    }
    return best;
}
/** @description Drop interior points of straight runs. The loop is implicitly closed. */
function simplifyLoop(points) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
        const prev = points[(i - 1 + n) % n];
        const here = points[i];
        const next = points[(i + 1) % n];
        const collinear = (here.x - prev.x) * (next.y - here.y) - (here.y - prev.y) * (next.x - here.x) === 0;
        if (!collinear)
            out.push(here);
    }
    return out;
}
/**
 * @description Trace every closed outline of a mask, in pixel-corner coordinates. Outer boundaries
 * run clockwise on screen, holes counter-clockwise.
 * @param mask - Input mask.
 * @returns Loops of corner points, each implicitly closed and free of collinear runs.
 */
function traceContours(mask) {
    const edges = boundaryEdges(mask);
    const outgoing = new Map();
    for (const edge of edges) {
        const key = keyOf(edge.from);
        const list = outgoing.get(key);
        if (list)
            list.push(edge);
        else
            outgoing.set(key, [edge]);
    }
    const loops = [];
    for (const start of edges) {
        if (start.used)
            continue;
        const loop = [];
        let edge = start;
        while (!edge.used) {
            edge.used = true;
            loop.push(edge.from);
            const candidates = (outgoing.get(keyOf(edge.to)) ?? []).filter((e) => !e.used);
            if (candidates.length === 0)
                break;
            edge = pickNext(candidates, { x: edge.to.x - edge.from.x, y: edge.to.y - edge.from.y });
        }
        if (loop.length >= 4)
            loops.push(simplifyLoop(loop));
    }
    return loops;
}
/**
 * @description Render loops as one SVG path `d` attribute, scaling and offsetting pixel corners
 * into sheet units. Use with `fill-rule="evenodd"` so holes stay holes.
 * @param loops - From {@link traceContours}.
 * @param scale - Sheet units per pixel.
 * @param offset - Sheet position of pixel corner (0, 0).
 * @param decimals - Coordinate decimals. Default 3.
 * @returns The path data.
 */
function loopsToPath(loops, scale, offset, decimals = 3) {
    const fmt = (v) => String(Number(v.toFixed(decimals)));
    return loops
        .map((loop) => loop.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(offset.x + p.x * scale)} ${fmt(offset.y + p.y * scale)}`).join(' ') + ' Z')
        .join(' ');
}
//# sourceMappingURL=contours.js.map