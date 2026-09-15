/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the schematic's wire and group geometry as
 *                     |                             | pure functions shared by the canvas (window.CircuitLabGeometry)
 *                     |                             | and the plain-node suite (module.exports): the corners a wire
 *                     |                             | passes through (automatic, one movable middle segment, or
 *                     |                             | several bend points), the SVG path through them, where a
 *                     |                             | double-click inserts a bend and which bend a double-click
 *                     |                             | removes, and a multi-selection turned a quarter clockwise
 *                     |                             | about its centre (positions, rotations and the routes of the
 *                     |                             | wires inside the group), refused when a part would leave the
 *                     |                             | canvas. No DOM, no I/O.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.CircuitLabGeometry = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const GRID = 20;
  /** The most bends one wire may carry — the contract's `limits.maxRoutePoints`. */
  const MAX_ROUTE_POINTS = 16;
  const snap = (v) => Math.round(v / GRID) * GRID;
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  const hasPoints = (route) => !!route && Array.isArray(route.points) && route.points.length > 0;

  /**
   * @description Every corner a wire passes through, pin to pin. A route with bend points goes through
   * them in order; otherwise the wire is the three-segment orthogonal path whose middle segment sits at
   * `route.mid` (or halfway), running along whichever axis separates the pins more.
   * @param {number[]} a the first pin, [x, y]
   * @param {number[]} b the second pin, [x, y]
   * @param {object|null} route the wire's route: {points} | {mid} | null
   * @returns {number[][]} [a, ...corners, b]
   */
  function routeVertices(a, b, route) {
    if (hasPoints(route)) return [a, ...route.points.map((p) => [p[0], p[1]]), b];
    const mid = route && Number.isFinite(route.mid) ? route.mid : null;
    if (Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1])) { const mx = mid === null ? (a[0] + b[0]) / 2 : mid; return [a, [mx, a[1]], [mx, b[1]], b]; }
    const my = mid === null ? (a[1] + b[1]) / 2 : mid;
    return [a, [a[0], my], [b[0], my], b];
  }

  /**
   * @description The SVG path through a wire's corners.
   * @param {number[][]} vertices from routeVertices
   * @returns {string} an absolute M / L path
   */
  function pathD(vertices) { return 'M' + vertices.map((v) => `${v[0]} ${v[1]}`).join(' L'); }

  /** Distance from point p to the segment u–v. */
  function segmentDistance(p, u, v) {
    const dx = v[0] - u[0], dy = v[1] - u[1], len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / len2));
    return Math.hypot(p[0] - (u[0] + t * dx), p[1] - (u[1] + t * dy));
  }

  /** True when q lies on the straight run from p to r (collinear and between them). */
  function between(p, q, r) {
    const cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(cross) < 1e-6 && q[0] >= Math.min(p[0], r[0]) - 1e-9 && q[0] <= Math.max(p[0], r[0]) + 1e-9 && q[1] >= Math.min(p[1], r[1]) - 1e-9 && q[1] <= Math.max(p[1], r[1]) + 1e-9;
  }

  /**
   * The inner corners that shape a wire: a corner repeating the one before it, or lying on the straight
   * run between its neighbours, carries no shape and is dropped — except the one at `keep` (a bend the
   * person just placed, which they mean to drag).
   */
  function innerPoints(vertices, keep) {
    const out = [vertices[0]];
    for (let i = 1; i < vertices.length - 1; i += 1) {
      const prev = out[out.length - 1], cur = vertices[i], next = vertices[i + 1];
      if (i !== keep && (same(cur, prev) || between(prev, cur, next))) continue;
      out.push([cur[0], cur[1]]);
    }
    return out.slice(1);
  }

  /** Where on segment u–v a click at `at` puts a bend: on the segment, snapped along it when it is horizontal or vertical. */
  function pointOnSegment(at, u, v) {
    const dx = v[0] - u[0], dy = v[1] - u[1], len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((at[0] - u[0]) * dx + (at[1] - u[1]) * dy) / len2));
    const q = [u[0] + t * dx, u[1] + t * dy];
    const inside = (x, a, b) => x >= Math.min(a, b) && x <= Math.max(a, b);
    if (dy === 0) { const x = snap(q[0]); return [inside(x, u[0], v[0]) ? x : q[0], u[1]]; }
    if (dx === 0) { const y = snap(q[1]); return [u[0], inside(y, u[1], v[1]) ? y : q[1]]; }
    return [Math.round(q[0]), Math.round(q[1])];
  }

  /**
   * @description The wire segment nearest a point.
   * @param {number[][]} vertices a wire's corners from routeVertices
   * @param {number[]} at a canvas point
   * @returns {{index: number, dist: number}} the segment (vertices[index] to vertices[index + 1]) and its distance
   */
  function nearestSegment(vertices, at) {
    let index = -1, dist = Infinity;
    for (let i = 0; i + 1 < vertices.length; i += 1) { const d = segmentDistance(at, vertices[i], vertices[i + 1]); if (d < dist) { dist = d; index = i; } }
    return { index, dist };
  }

  /**
   * @description Insert a bend where a double-click landed: the click must be within `tolerance` of the
   * wire and clear of both pins. The wire's current corners become explicit bend points (so an
   * automatic or middle-segment route keeps its drawn shape) and the new point goes onto the segment
   * nearest the click — snapped to the grid along a horizontal or vertical run, so placing a bend never
   * changes the drawn wire; dragging it then moves it on the grid.
   * @param {number[][]} vertices the wire's corners from routeVertices
   * @param {number[]} at the click, [x, y]
   * @param {number} tolerance how far from the wire a click still counts
   * @returns {{points: number[][]}|{error: string}|null} the new route, a refusal, or null when the click missed the wire
   */
  function insertBend(vertices, at, tolerance) {
    const { index, dist } = nearestSegment(vertices, at);
    const ends = [vertices[0], vertices[vertices.length - 1]];
    if (index < 0 || dist > tolerance || ends.some((e) => Math.hypot(at[0] - e[0], at[1] - e[1]) <= tolerance)) return null;
    const bend = pointOnSegment(at, vertices[index], vertices[index + 1]);
    const points = innerPoints([...vertices.slice(0, index + 1), bend, ...vertices.slice(index + 1)], index + 1);
    if (points.length > MAX_ROUTE_POINTS) return { error: `a wire carries at most ${MAX_ROUTE_POINTS} bends` };
    return { points };
  }

  /**
   * @description The bend nearest a point, when one is within `tolerance`.
   * @param {object|null} route the wire's route
   * @param {number[]} at a canvas point
   * @param {number} tolerance the pick radius
   * @returns {number} the bend's index in route.points, or -1
   */
  function bendAt(route, at, tolerance) {
    if (!hasPoints(route)) return -1;
    let best = -1, dist = tolerance;
    route.points.forEach((p, i) => { const d = Math.hypot(at[0] - p[0], at[1] - p[1]); if (d <= dist) { dist = d; best = i; } });
    return best;
  }

  /**
   * @description A route with one bend taken out; the last bend gone leaves no route at all (the wire
   * falls back to its automatic path).
   * @param {object} route a route with points
   * @param {number} index the bend to remove
   * @returns {{points: number[][]}|null} the remaining route
   */
  function removeBend(route, index) {
    const points = route.points.filter((_, i) => i !== index).map((p) => [p[0], p[1]]);
    return points.length ? { points } : null;
  }

  /** A point turned a quarter clockwise (on screen, y down) about c. */
  const quarter = (p, c) => [c[0] - (p[1] - c[1]), c[1] + (p[0] - c[0])];

  /**
   * @description Turn a multi-selection a quarter clockwise about its centre — the grid-snapped middle of
   * the parts' bounding box, so parts on the grid stay on it. Every part's position turns about the
   * centre and its own rotation advances 90°, so the group turns rigidly (pins included). A wire with a
   * route whose two ends are both in the group keeps its drawn shape: its corners turn with it as bend
   * points. Wires crossing the group's edge keep their routes.
   * @param {object[]} parts the circuit's parts ({id, x, y, rotation})
   * @param {object[]} wires the circuit's wires
   * @param {string[]} ids the selected part ids (two or more)
   * @param {{w: number, h: number, margin: number, verticesOf: function}} frame the world size, the
   *   margin a part must keep from its edge, and a function giving a wire's current corners
   * @returns {{parts: object[], wires: object[], centre: number[]}} new arrays (unselected items identical)
   * @throws {Error} naming the first part the turn would push off the canvas
   */
  function rotateGroup(parts, wires, ids, frame) {
    const chosen = new Set(ids), group = parts.filter((p) => chosen.has(p.id));
    if (group.length < 2) throw new Error('select two or more parts to turn them as a group');
    const xs = group.map((p) => p.x), ys = group.map((p) => p.y);
    const c = [snap((Math.min(...xs) + Math.max(...xs)) / 2), snap((Math.min(...ys) + Math.max(...ys)) / 2)];
    const next = parts.map((p) => {
      if (!chosen.has(p.id)) return p;
      const [x, y] = quarter([p.x, p.y], c);
      if (x < frame.margin || x > frame.w - frame.margin || y < frame.margin || y > frame.h - frame.margin) throw new Error(`turning the group would move ${p.id} off the canvas`);
      return Object.assign({}, p, { x, y, rotation: ((p.rotation || 0) + 90) % 360 });
    });
    const turned = wires.map((w) => {
      if (!w.route || !chosen.has(w.from.part) || !chosen.has(w.to.part)) return w;
      const points = innerPoints(frame.verticesOf(w), -1).map((p) => quarter(p, c));
      return Object.assign({}, w, { route: points.length ? { points } : null });
    });
    return { parts: next, wires: turned, centre: c };
  }

  return { GRID, MAX_ROUTE_POINTS, snap, routeVertices, pathD, segmentDistance, nearestSegment, insertBend, bendAt, removeBend, rotateGroup };
});
