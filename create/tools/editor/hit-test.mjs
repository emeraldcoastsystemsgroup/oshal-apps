/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Pick visible unlocked layers in paint order using rotated shape and stroke geometry.
 */
import { number, validateProject } from './model-validation.mjs';

/** @description Convert canvas coordinates into the unrotated local layer rectangle.
 * @param {object} layer Normalized layer.
 * @param {{x:number,y:number}} point Canvas-space point.
 * @returns {{x:number,y:number}} Layer-local point in project pixels. */
export function worldToLayer(layer, point) {
  const angle = -layer.rotation * Math.PI / 180, x = point.x - layer.x - layer.w / 2, y = point.y - layer.y - layer.h / 2;
  return { x: x * Math.cos(angle) - y * Math.sin(angle) + layer.w / 2,
    y: x * Math.sin(angle) + y * Math.cos(angle) + layer.h / 2 };
}

function painted(color) { return color !== 'transparent' && !/^#[a-f0-9]{3}0$|^#[a-f0-9]{6}00$/i.test(color); }

function rectangle(point, width, height, padding) {
  return point.x >= -padding && point.x <= width + padding && point.y >= -padding && point.y <= height + padding;
}

function ellipse(point, width, height, padding) {
  const rx = width / 2 + padding, ry = height / 2 + padding;
  return rx > 0 && ry > 0 && ((point.x - width / 2) / rx) ** 2 + ((point.y - height / 2) / ry) ** 2 <= 1;
}

function segmentDistance(point, first, last) {
  const dx = last.x - first.x, dy = last.y - first.y, squared = dx * dx + dy * dy;
  const fraction = squared ? Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / squared)) : 0;
  return Math.hypot(point.x - first.x - fraction * dx, point.y - first.y - fraction * dy);
}

function strokeHit(layer, point, tolerance) {
  if (!painted(layer.stroke)) return false;
  const radius = layer.strokeWidth / 2 + tolerance, points = layer.points.map(item => ({ x: item.x * layer.w, y: item.y * layer.h }));
  return points.some((item, index) => segmentDistance(point, index ? points[index - 1] : item, item) <= radius);
}

function contains(layer, point, tolerance) {
  if (layer.type === 'freehand') return strokeHit(layer, point, tolerance);
  if (layer.type === 'image') return rectangle(point, layer.w, layer.h, tolerance);
  if (layer.type === 'text') return painted(layer.fill) && rectangle(point, layer.w, layer.h, tolerance);
  const shape = layer.type === 'ellipse' ? ellipse : rectangle;
  if (painted(layer.fill) && shape(point, layer.w, layer.h, tolerance)) return true;
  const padding = layer.strokeWidth / 2 + tolerance;
  return painted(layer.stroke) && layer.strokeWidth > 0 && shape(point, layer.w, layer.h, padding)
    && !shape(point, layer.w, layer.h, -padding);
}

/** @description Pick the uppermost painted layer; hidden, transparent and locked layers do not intercept editing.
 * @param {object} project Layered project, with bottom-to-top ordering.
 * @param {{x:number,y:number}} point Canvas-space point.
 * @param {{tolerance?:number,includeLocked?:boolean}} options Pixel tolerance and explicit locked-layer selection.
 * @returns {object|null} Independent selected layer or null; images/text use their geometric boxes. */
export function hitTest(project, point, options = {}) {
  number(point?.x, -65536, 65536, 'Pointer x'); number(point?.y, -65536, 65536, 'Pointer y');
  const tolerance = number(options.tolerance ?? 0, 0, 100, 'Hit tolerance'), normalized = validateProject(project);
  for (const layer of normalized.layers.slice().reverse()) {
    if (!layer.visible || layer.opacity === 0 || (layer.locked && !options.includeLocked)) continue;
    if (contains(layer, worldToLayer(layer, point), tolerance)) return layer;
  }
  return null;
}
