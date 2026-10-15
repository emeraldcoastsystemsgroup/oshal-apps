/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Map isolated, uniformly scaled groups to world-space geometry without changing child source coordinates.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 */
import { demand } from './model-validation.mjs';

/** @description Find the immediate parent group of a layer.
 * @param {object} project Validated document.
 * @param {string} id Layer ID.
 * @returns {object|undefined} Parent group. */
export function parentGroup(project, id) { return project.layers.find(layer => layer.type === 'group' && layer.children.includes(id)); }

/** @description Transform a child's geometry through a parent's uniform scale and rotation.
 * @param {object} layer Child geometry in group-local coordinates.
 * @param {object} group Parent geometry in its own parent coordinates.
 * @returns {object} Child geometry in parent coordinates. */
export function throughGroup(layer, group) {
  const scale = group.w / group.baseWidth, angle = group.rotation * Math.PI / 180;
  const dx = (layer.x + layer.w / 2 - group.baseWidth / 2) * scale;
  const dy = (layer.y + layer.h / 2 - group.baseHeight / 2) * scale;
  const w = layer.w * scale, h = layer.h * scale;
  return { ...layer, x: group.x + group.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle) - w / 2,
    y: group.y + group.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) - h / 2,
    w, h, rotation: layer.rotation + group.rotation };
}

/** @description Resolve stable child geometry for overlays, hit testing and source-pixel selections.
 * @param {object} project Validated document.
 * @param {object|string} value Layer or ID.
 * @returns {object} World geometry with ancestor visibility and locks. */
export function worldLayer(project, value) {
  let layer = typeof value === 'string' ? project.layers.find(item => item.id === value) : value;
  demand(layer, 'Layer does not exist'); let parent = parentGroup(project, layer.id), depth = 0;
  while (parent) {
    demand(++depth <= 4, 'Groups are nested too deeply');
    layer = { ...throughGroup(layer, parent), visible: layer.visible && parent.visible,
      locked: layer.locked || parent.locked };
    parent = parentGroup(project, parent.id);
  }
  return layer;
}

function curveExtrema(a, b, c, d) {
  const result = [a, d], times = new Set();
  for (const axis of ['x', 'y']) {
    const A = -a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis];
    const B = 2 * (a[axis] - 2 * b[axis] + c[axis]), C = b[axis] - a[axis];
    if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) times.add(-C / B); }
    else { const discriminant = B * B - 4 * A * C; if (discriminant >= 0) { const root = Math.sqrt(discriminant); times.add((-B + root) / (2 * A)); times.add((-B - root) / (2 * A)); } }
  }
  for (const t of times) if (t > 0 && t < 1) {
    const u = 1 - t; result.push({ x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
      y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y });
  }
  return result;
}

function curveBounds(layer) {
  const angle = layer.rotation * Math.PI / 180;
  const mapped = (x, y) => ({ x: layer.x + layer.w / 2 + (x * layer.w - layer.w / 2) * Math.cos(angle) - (y * layer.h - layer.h / 2) * Math.sin(angle),
    y: layer.y + layer.h / 2 + (x * layer.w - layer.w / 2) * Math.sin(angle) + (y * layer.h - layer.h / 2) * Math.cos(angle) });
  return layer.contours.flatMap(contour => contour.nodes.flatMap((a, index) => {
    if (!contour.closed && index === contour.nodes.length - 1) return [];
    const d = contour.nodes[(index + 1) % contour.nodes.length];
    return curveExtrema(mapped(a.x, a.y), mapped(a.x + a.out.x, a.y + a.out.y), mapped(d.x + d.in.x, d.y + d.in.y), mapped(d.x, d.y));
  }));
}

/** @description Bound rotated paint geometry plus its stroke for a new group frame.
 * @param {object[]} layers Sibling paint layers.
 * @returns {object} Integer group frame preserving their positions. */
export function groupFrame(layers) {
  const corners = layers.filter(layer => layer.type !== 'adjustment').flatMap(layer => {
    if (layer.type === 'path') {
      const padding = (layer.strokeWidth ?? 0) * (layer.join === 'miter' ? 5 : .5);
      return curveBounds(layer).flatMap(point => [{ x: point.x - padding, y: point.y - padding }, { x: point.x + padding, y: point.y + padding }]);
    }
    const angle = layer.rotation * Math.PI / 180, padding = (layer.strokeWidth ?? 0) / 2 + (layer.blur ?? 0) * 3;
    return [[-padding, -padding], [layer.w + padding, -padding], [layer.w + padding, layer.h + padding], [-padding, layer.h + padding]].map(([x, y]) => ({
      x: layer.x + layer.w / 2 + (x - layer.w / 2) * Math.cos(angle) - (y - layer.h / 2) * Math.sin(angle),
      y: layer.y + layer.h / 2 + (x - layer.w / 2) * Math.sin(angle) + (y - layer.h / 2) * Math.cos(angle) }));
  });
  const bounds = corners.reduce((box, point) => ({ left: Math.min(box.left, point.x), top: Math.min(box.top, point.y), right: Math.max(box.right, point.x), bottom: Math.max(box.bottom, point.y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const x = Math.floor(bounds.left), y = Math.floor(bounds.top);
  return { x, y, w: Math.max(1, Math.ceil(bounds.right) - x), h: Math.max(1, Math.ceil(bounds.bottom) - y) };
}
