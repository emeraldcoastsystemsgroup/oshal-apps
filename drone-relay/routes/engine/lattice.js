"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The LATTICE (backlog B9): a survey AREA instead of a work
 *                     |                             | point. The area is a polygon; the slots are the nodes of a
 *                     |                             | square grid anchored at the base with the design hop as its
 *                     |                             | spacing, every node whose cell touches the area (within half
 *                     |                             | a cell diagonal of it) — so wherever the tip is inside the
 *                     |                             | area a slot is at most 0.71 hop away, and neighbouring slots
 *                     |                             | are exactly one hop apart. Parts of the lattice the grid does
 *                     |                             | not join to the base (an area away from it, a waist in the
 *                     |                             | polygon) are joined by the shortest run of FEEDER nodes. Every
 *                     |                             | slot knows its depth (hops from the base) and its parent (the
 *                     |                             | neighbour one hop nearer). The ASSIGNMENT rule is the elastic
 *                     |                             | rule's generalisation: with k relays, occupy the lattice route
 *                     |                             | from the base to the slot nearest the tip first, then every
 *                     |                             | other slot inner first. The tip's survey is a back-and-forth
 *                     |                             | sweep of the area one lattice spacing apart. Pure geometry;
 *                     |                             | refusals name the field.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LATTICE_LIMITS = void 0;
exports.polygonArea = polygonArea;
exports.pointInPolygon = pointInPolygon;
exports.distanceToArea = distanceToArea;
exports.validateArea = validateArea;
exports.surveyPath = surveyPath;
exports.latticeGeometry = latticeGeometry;
exports.nearestNode = nearestNode;
exports.latticeRoute = latticeRoute;
exports.latticeAssign = latticeAssign;
const path_1 = require("./path");
const spec_error_1 = require("./spec-error");
/** @description What the validator and the tiling hold an area to. */
exports.LATTICE_LIMITS = { minPoints: 3, maxPoints: 64, maxExtentM: 20_000, maxGridCells: 40_000, maxSlots: 256 };
const EPS = 1e-9;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (i, j) => `${i},${j}`;
/**
 * @description The polygon's area (shoelace), m².
 * @param poly - Vertices in order.
 * @returns Area, always positive.
 */
function polygonArea(poly) {
    let twice = 0;
    for (let a = 0; a < poly.length; a += 1) {
        const p = poly[a];
        const q = poly[(a + 1) % poly.length];
        twice += p.x * q.y - q.x * p.y;
    }
    return Math.abs(twice) / 2;
}
/**
 * @description Whether a point lies inside the polygon (even-odd rule).
 * @param p - The point.
 * @param poly - The polygon.
 * @returns True inside.
 */
function pointInPolygon(p, poly) {
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a, a += 1) {
        const pa = poly[a];
        const pb = poly[b];
        if ((pa.y > p.y) !== (pb.y > p.y) && p.x < ((pb.x - pa.x) * (p.y - pa.y)) / (pb.y - pa.y) + pa.x)
            inside = !inside;
    }
    return inside;
}
function segmentPointM(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/**
 * @description Distance from a point to the area: 0 inside, else to the nearest edge.
 * @param p - The point.
 * @param poly - The polygon.
 * @returns Metres.
 */
function distanceToArea(p, poly) {
    if (pointInPolygon(p, poly))
        return 0;
    let best = Number.POSITIVE_INFINITY;
    for (let a = 0; a < poly.length; a += 1)
        best = Math.min(best, segmentPointM(p, poly[a], poly[(a + 1) % poly.length]));
    return best;
}
function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function edgesCross(a1, a2, b1, b2) {
    const d1 = cross(b1, b2, a1);
    const d2 = cross(b1, b2, a2);
    const d3 = cross(a1, a2, b1);
    const d4 = cross(a1, a2, b2);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
        return true;
    const on = (p, q, r) => Math.abs(cross(p, q, r)) < EPS && Math.min(p.x, q.x) - EPS <= r.x && r.x <= Math.max(p.x, q.x) + EPS && Math.min(p.y, q.y) - EPS <= r.y && r.y <= Math.max(p.y, q.y) + EPS;
    return on(b1, b2, a1) || on(b1, b2, a2) || on(a1, a2, b1) || on(a1, a2, b2);
}
/**
 * @description Validate a survey area from untrusted input: 3 to 64 finite points (x east, y north,
 * metres from the base), edges of a metre or more that never cross, an area of at least 1 m² and an
 * extent of at most 20 km. The base need not be inside: the lattice feeds out to it.
 * @param input - Candidate vertices.
 * @returns The polygon (z dropped: a lattice is flat).
 */
function validateArea(input) {
    const L = exports.LATTICE_LIMITS;
    if (!Array.isArray(input) || input.length < L.minPoints)
        throw new spec_error_1.SpecError('area', `area needs at least ${L.minPoints} points: the polygon the tip surveys`);
    if (input.length > L.maxPoints)
        throw new spec_error_1.SpecError('area', `area may carry at most ${L.maxPoints} points`);
    const poly = input.map((raw, i) => {
        const p = raw && typeof raw === 'object' ? raw : {};
        const pt = { x: Number(p.x), y: Number(p.y), z: 0 };
        if (![pt.x, pt.y].every(Number.isFinite))
            throw new spec_error_1.SpecError(`area[${i}]`, 'every area point needs finite x and y');
        if (Math.abs(pt.x) > 50_000 || Math.abs(pt.y) > 50_000)
            throw new spec_error_1.SpecError(`area[${i}]`, 'area point is out of range');
        return pt;
    });
    poly.forEach((p, i) => { if ((0, path_1.distance)(p, poly[(i + 1) % poly.length]) < 1)
        throw new spec_error_1.SpecError(`area[${(i + 1) % poly.length}]`, 'area edges must be at least one metre'); });
    for (let a = 0; a < poly.length; a += 1) {
        for (let b = a + 2; b < poly.length; b += 1) {
            if (a === 0 && b === poly.length - 1)
                continue;
            if (edgesCross(poly[a], poly[a + 1], poly[b], poly[(b + 1) % poly.length]))
                throw new spec_error_1.SpecError('area', `the area's edges ${a}–${a + 1} and ${b}–${(b + 1) % poly.length} cross: give the polygon's points in order around it`);
        }
    }
    if (polygonArea(poly) < 1)
        throw new spec_error_1.SpecError('area', 'the area encloses less than a square metre');
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) > L.maxExtentM || Math.max(...ys) - Math.min(...ys) > L.maxExtentM)
        throw new spec_error_1.SpecError('area', `the area spans more than ${L.maxExtentM} m`);
    return poly;
}
/** Grid nodes whose cell touches the area: inside it, or within half a cell diagonal of an edge. */
function coveringNodes(area, g) {
    const r = (g * Math.SQRT2) / 2;
    const xs = area.map((p) => p.x);
    const ys = area.map((p) => p.y);
    const i0 = Math.ceil((Math.min(...xs) - r) / g);
    const i1 = Math.floor((Math.max(...xs) + r) / g);
    const j0 = Math.ceil((Math.min(...ys) - r) / g);
    const j1 = Math.floor((Math.max(...ys) + r) / g);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > exports.LATTICE_LIMITS.maxGridCells)
        throw new spec_error_1.SpecError('area', `the area needs more than ${exports.LATTICE_LIMITS.maxGridCells} grid cells at a ${Math.round(g)} m hop: survey a smaller area or use a longer hop`);
    const out = new Set();
    for (let i = i0; i <= i1; i += 1)
        for (let j = j0; j <= j1; j += 1)
            if ((i !== 0 || j !== 0) && distanceToArea({ x: i * g, y: j * g }, area) <= r + EPS)
                out.add(key(i, j));
    return out;
}
/** Breadth-first over `allowed` from the base, neighbours in a fixed order; returns depth and parent per node. */
function bfs(allowed) {
    const seen = new Map([[key(0, 0), { depth: 0, parent: '' }]]);
    const queue = [[0, 0]];
    for (let q = 0; q < queue.length; q += 1) {
        const [i, j] = queue[q];
        const depth = seen.get(key(i, j)).depth;
        for (const [di, dj] of STEPS) {
            const k = key(i + di, j + dj);
            if (!allowed.has(k) || seen.has(k))
                continue;
            seen.set(k, { depth: depth + 1, parent: key(i, j) });
            queue.push([i + di, j + dj]);
        }
    }
    return seen;
}
/** The shortest grid run from any node already joined to the nearest node not yet joined (fixed neighbour order). */
function feederRun(joined, wanted, box) {
    const from = new Map();
    const queue = [];
    for (const k of [...joined].sort()) {
        const [i, j] = k.split(',').map(Number);
        queue.push([i, j]);
        from.set(k, '');
    }
    for (let q = 0; q < queue.length; q += 1) {
        const [i, j] = queue[q];
        for (const [di, dj] of STEPS) {
            const ni = i + di;
            const nj = j + dj;
            const k = key(ni, nj);
            if (ni < box.i0 || ni > box.i1 || nj < box.j0 || nj > box.j1 || from.has(k))
                continue;
            from.set(k, key(i, j));
            if (wanted.has(k)) {
                const run = [];
                for (let c = from.get(k); c && !joined.has(c); c = from.get(c))
                    run.push(c);
                return run;
            }
            queue.push([ni, nj]);
        }
    }
    return [];
}
/** Join every part of the cover to the base with feeder nodes; returns the feeder keys added. */
function joinToBase(cover) {
    const feeder = new Set();
    const coords = [...cover, key(0, 0)].map((k) => k.split(',').map(Number));
    const box = { i0: Math.min(...coords.map((c) => c[0])) - 1, i1: Math.max(...coords.map((c) => c[0])) + 1, j0: Math.min(...coords.map((c) => c[1])) - 1, j1: Math.max(...coords.map((c) => c[1])) + 1 };
    for (let guard = 0; guard <= cover.size; guard += 1) {
        const all = new Set([...cover, ...feeder]);
        const joined = new Set(bfs(all).keys());
        const missing = new Set([...cover].filter((k) => !joined.has(k)));
        if (!missing.size)
            return feeder;
        for (const k of feederRun(joined, missing, box))
            feeder.add(k);
    }
    return feeder;
}
/**
 * @description Back and forth across the area, one lattice spacing between passes, alternating
 * direction; each pass is the part of its line inside the polygon.
 * @param area - The polygon.
 * @param laneM - Distance between passes.
 * @returns The sweep's turning points (at least one point).
 */
function surveyPath(area, laneM) {
    const ys = area.map((p) => p.y);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const passes = Math.max(1, Math.round((y1 - y0) / laneM));
    const out = [];
    for (let n = 0; n < passes; n += 1) {
        const y = y0 + ((y1 - y0) * (n + 0.5)) / passes;
        const xs = [];
        for (let a = 0; a < area.length; a += 1) {
            const p = area[a];
            const q = area[(a + 1) % area.length];
            if ((p.y > y) !== (q.y > y))
                xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
        }
        xs.sort((a, b) => a - b);
        const legs = [];
        for (let k = 0; k + 1 < xs.length; k += 2)
            legs.push({ x: xs[k], y, z: 0 }, { x: xs[k + 1], y, z: 0 });
        out.push(...(n % 2 ? legs.reverse() : legs));
    }
    if (!out.length)
        out.push({ x: area.reduce((s, p) => s + p.x, 0) / area.length, y: area.reduce((s, p) => s + p.y, 0) / area.length, z: 0 });
    return out;
}
/**
 * @description Tile the area: the covering grid nodes at `spacingM`, joined to the base, each with
 * its depth and parent, numbered breadth-first from the base (inner first).
 * @param area - The validated polygon.
 * @param spacingM - The design hop.
 * @returns The lattice.
 */
function latticeGeometry(area, spacingM) {
    const cover = coveringNodes(area, spacingM);
    const feeder = joinToBase(cover);
    const all = new Set([...cover, ...feeder]);
    if (all.size > exports.LATTICE_LIMITS.maxSlots)
        throw new spec_error_1.SpecError('area', `the area tiles into ${all.size} slots at a ${Math.round(spacingM)} m hop; at most ${exports.LATTICE_LIMITS.maxSlots}`);
    const tree = bfs(all);
    const order = [...tree.keys()].filter((k) => k !== key(0, 0));
    const indexOf = new Map(order.map((k, n) => [k, n + 1]));
    const nodes = order.map((k, n) => {
        const [i, j] = k.split(',').map(Number);
        const t = tree.get(k);
        return { index: n + 1, i, j, x: i * spacingM, y: j * spacingM, depth: t.depth, parent: t.parent === key(0, 0) ? 0 : indexOf.get(t.parent), feeder: feeder.has(k) };
    });
    const survey = surveyPath(area, spacingM);
    const loop = [...survey, survey[0]];
    let surveyM = 0;
    for (let n = 1; n < loop.length; n += 1)
        surveyM += (0, path_1.distance)(loop[n - 1], loop[n]);
    return { spacingM, coverM: (spacingM * Math.SQRT2) / 2, nodes, maxDepth: nodes.reduce((m, n) => Math.max(m, n.depth), 0), areaM2: polygonArea(area), survey, surveyM };
}
/**
 * @description The slot nearest a point (ties to the lower index).
 * @param geo - The lattice.
 * @param p - The point.
 * @returns The slot's index.
 */
function nearestNode(geo, p) {
    let best = geo.nodes[0];
    for (const n of geo.nodes)
        if (Math.hypot(n.x - p.x, n.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) - EPS)
            best = n;
    return best.index;
}
/**
 * @description The lattice route from the base out to a slot: its parents, depth 1 first.
 * @param geo - The lattice.
 * @param index - The slot.
 * @returns Slot indices, inner → outer, ending at `index`.
 */
function latticeRoute(geo, index) {
    const route = [];
    for (let n = index; n > 0; n = geo.nodes[n - 1].parent)
        route.unshift(n);
    return route;
}
/**
 * @description The assignment rule: with `k` relays, the slots to hold — the route from the base to
 * the slot nearest the tip first (so the tip is in reach wherever it is, once `k` covers that
 * route), then every other slot breadth-first from the base (inner first).
 * @param geo - The lattice.
 * @param k - Relays the controller has.
 * @param tip - The tip's position.
 * @returns Slot indices in priority order, at most `k` of them.
 */
function latticeAssign(geo, k, tip) {
    const route = latticeRoute(geo, nearestNode(geo, tip));
    const onRoute = new Set(route);
    return [...route, ...geo.nodes.map((n) => n.index).filter((n) => !onRoute.has(n))].slice(0, Math.max(0, k));
}
//# sourceMappingURL=lattice.js.map