/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Preserve editable cubic nodes and flatten bounded closed paths for robust polygon booleans.
 */
import clipping from './polygon-clipping.mjs';
import { demand } from './model-validation.mjs';
import { worldLayer } from './group-geometry.mjs';

/** @description Trace exact cubic vector contours into Canvas2D.
 * @param {object} ctx Canvas or Path2D-compatible path sink.
 * @param {object} layer Normalized vector layer.
 * @returns {void} */
export function traceVector(ctx, layer) {
  for (const contour of layer.contours) {
    const nodes = contour.nodes, first = nodes[0]; ctx.moveTo(first.x * layer.w, first.y * layer.h);
    const count = contour.closed ? nodes.length : nodes.length - 1;
    for (let index = 0; index < count; index++) {
      const from = nodes[index], to = nodes[(index + 1) % nodes.length];
      ctx.bezierCurveTo((from.x + from.out.x) * layer.w, (from.y + from.out.y) * layer.h,
        (to.x + to.in.x) * layer.w, (to.y + to.in.y) * layer.h, to.x * layer.w, to.y * layer.h);
    }
    if (contour.closed) ctx.closePath();
  }
}

function point(layer, x, y) {
  const angle = layer.rotation * Math.PI / 180, dx = x - layer.w / 2, dy = y - layer.h / 2;
  return [layer.x + layer.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    layer.y + layer.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)];
}

function distance(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
  return length ? Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length : Math.hypot(point[0] - start[0], point[1] - start[1]);
}

function flattenCurve(a, b, c, d, output, depth = 0) {
  demand(output.length < 10000, 'Boolean curve tessellation exceeds its point budget');
  if (Math.max(distance(b, a, d), distance(c, a, d)) <= .1 || depth >= 16) { output.push(d); return; }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
  flattenCurve(a, ab, abc, center, output, depth + 1); flattenCurve(center, bcd, cd, d, output, depth + 1);
}

function rings(layer) {
  demand(layer.type === 'path' && !layer.clip, 'Booleans require unclipped vector paths');
  return layer.contours.map(contour => {
    demand(contour.closed, 'Close the paths before combining them');
    const nodes = contour.nodes, result = [point(layer, nodes[0].x * layer.w, nodes[0].y * layer.h)];
    for (let index = 0; index < nodes.length; index++) {
      const a = nodes[index], d = nodes[(index + 1) % nodes.length];
      flattenCurve(point(layer, a.x * layer.w, a.y * layer.h), point(layer, (a.x + a.out.x) * layer.w, (a.y + a.out.y) * layer.h),
        point(layer, (d.x + d.in.x) * layer.w, (d.y + d.in.y) * layer.h), point(layer, d.x * layer.w, d.y * layer.h), result);
    }
    return result;
  });
}

function booleanGeometry(layer) {
  const contours = rings(layer);
  if (layer.fillRule === 'evenodd') return clipping.xor(...contours.map(ring => [ring]));
  const signs = contours.map(ring => Math.sign(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]; return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)));
  demand(signs.every(sign => sign === signs[0]), 'Mixed-winding nonzero contours need an even-odd conversion before booleans');
  return clipping.union(...contours.map(ring => [ring]));
}

/** @description Build editable straight/cubic contours from canvas-space point rings.
 * @param {number[][][]} rings Closed coordinate rings.
 * @param {object} options Style and identity metadata.
 * @returns {object} Independent vector layer. */
export function pathFromRings(rings, options = {}) {
  demand(rings.length > 0, 'The boolean result is empty'); const all = rings.flat();
  const x = Math.min(...all.map(point => point[0])), y = Math.min(...all.map(point => point[1]));
  const w = Math.max(.1, Math.max(...all.map(point => point[0])) - x), h = Math.max(.1, Math.max(...all.map(point => point[1])) - y);
  return { type: 'path', x, y, w, h, fill: '#7c3aed', ...options, contours: rings.map(ring => ({ closed: true,
    nodes: ring.slice(0, ring.length > 2 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? -1 : undefined)
      .map(([px, py]) => ({ x: Math.max(0, Math.min(1, (px - x) / w)), y: Math.max(0, Math.min(1, (py - y) / h)) })) })) };
}

/** @description Combine two root paths with a 0.1 canvas-pixel flattening tolerance; original operands remain separate.
 * @param {object} project Validated editable project.
 * @param {string[]} ids Exactly two operand IDs.
 * @param {string} operation union, difference, intersection or xor.
 * @returns {object} New editable result layer with operand lineage. */
export function combinePaths(project, ids, operation) {
  demand(['union', 'difference', 'intersection', 'xor'].includes(operation) && ids.length === 2, 'Choose two paths and a supported boolean');
  const paths = ids.map(id => worldLayer(project, id));
  demand(paths.every(layer => !layer.locked && layer.visible), 'Boolean operands must be visible and unlocked');
  const geometry = paths.map(layer => booleanGeometry(layer));
  demand(geometry.every(value => value.flat(2).length <= 10000), 'Boolean input is too complex');
  const output = clipping[operation](...geometry); demand(output.flat(2).length <= 10000, 'Boolean result is too complex');
  const first = paths[0], result = pathFromRings(output.flat(), { name: `${operation} result`, fill: first.fill, stroke: first.stroke,
    strokeWidth: first.strokeWidth, opacity: first.opacity, cap: first.cap, join: first.join, dash: first.dash, fillRule: 'evenodd', sourceIds: ids });
  if (first.gradient) {
    const normalize = value => { const world = point(first, value.x * first.w, value.y * first.h); return { x: (world[0] - result.x) / result.w, y: (world[1] - result.y) / result.h }; };
    result.gradient = { from: normalize(first.gradient.from), to: normalize(first.gradient.to), stops: first.gradient.stops };
  }
  return result;
}
