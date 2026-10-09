/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Map lasso, box and whole-image selections onto one image layer's SOURCE pixels, so zoom, move, resize, rotation and crop never shift the requested region; clip it to the visible crop and refuse stale, ambiguous, locked, hidden or too-small selections before use.
 */
import { demand, number, identifier, objectKeys, validateProject } from './model-validation.mjs';
import { worldToLayer } from './hit-test.mjs';

/** @description Region selection ceilings: outline points, smallest usable area (source px²) and inward feather (source px).
 * @returns {object} Immutable limits. */
export const REGION_LIMITS = Object.freeze({ points: 2000, minArea: 64, feather: 32 });
const KINDS = new Set(['lasso', 'box', 'layer']);
const FIELDS = ['version', 'kind', 'layerId', 'assetId', 'sourceWidth', 'sourceHeight', 'feather', 'points'];
const round = value => Math.round(value * 100) / 100;

/** @description Convert a pointer position to canvas pixels using the canvas element's displayed box, whatever the zoom.
 * @param {{x:number,y:number}} client Pointer client coordinates.
 * @param {{left:number,top:number,width:number,height:number}} rect Displayed canvas rectangle.
 * @param {{width:number,height:number}} project Canvas dimensions in project pixels.
 * @returns {{x:number,y:number}} Canvas-space point. */
export function clientToCanvas(client, rect, project) {
  demand(rect && rect.width > 0 && rect.height > 0, 'The canvas is not visible');
  return { x: (client.x - rect.left) * project.width / rect.width, y: (client.y - rect.top) * project.height / rect.height };
}

/** @description Map a canvas point into the layer's source image pixels through rotation, resize and crop.
 * @param {object} layer Normalized image layer.
 * @param {{width:number,height:number}} asset Source image dimensions.
 * @param {{x:number,y:number}} point Canvas-space point.
 * @returns {{x:number,y:number}} Unclamped source-pixel point. */
export function canvasToSource(layer, asset, point) {
  const local = worldToLayer(layer, point), crop = layer.crop;
  return { x: (crop.x + local.x / layer.w * crop.w) * asset.width, y: (crop.y + local.y / layer.h * crop.h) * asset.height };
}

/** @description Map a source-pixel point back onto the canvas; the exact inverse of canvasToSource.
 * @param {object} layer Normalized image layer.
 * @param {{width:number,height:number}} asset Source image dimensions.
 * @param {{x:number,y:number}} point Source-pixel point.
 * @returns {{x:number,y:number}} Canvas-space point. */
export function sourceToCanvas(layer, asset, point) {
  const crop = layer.crop, angle = layer.rotation * Math.PI / 180;
  const dx = (point.x / asset.width - crop.x) / crop.w * layer.w - layer.w / 2;
  const dy = (point.y / asset.height - crop.y) / crop.h * layer.h - layer.h / 2;
  return { x: layer.x + layer.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: layer.y + layer.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

/** @description The part of the source image the layer currently shows.
 * @param {object} layer Normalized image layer.
 * @param {{width:number,height:number}} asset Source image dimensions.
 * @returns {{x:number,y:number,w:number,h:number}} Visible source rectangle in source pixels. */
export function visibleSourceRect(layer, asset) {
  return { x: layer.crop.x * asset.width, y: layer.crop.y * asset.height, w: layer.crop.w * asset.width, h: layer.crop.h * asset.height };
}

/** @description Absolute shoelace area of a closed outline.
 * @param {{x:number,y:number}[]} points Outline vertices.
 * @returns {number} Enclosed area in the points' units squared. */
export function polygonArea(points) {
  let twice = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length]; twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** @description Whole-pixel bounding box of an outline.
 * @param {{x:number,y:number}[]} points Outline vertices.
 * @returns {{x:number,y:number,w:number,h:number}} Integer bounds covering every vertex. */
export function selectionBounds(points) {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  return { x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y };
}

function clipEdge(points, inside, cross) {
  const result = [];
  points.forEach((current, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    if (inside(current)) { if (!inside(previous)) result.push(cross(previous, current)); result.push(current); }
    else if (inside(previous)) result.push(cross(previous, current));
  });
  return result;
}

/** Sutherland-Hodgman against the axis-aligned visible rectangle: the exact intersection with what the layer shows. */
function clipToRect(points, rect) {
  const along = (axis, edge) => (a, b) => {
    const t = (edge - a[axis]) / (b[axis] - a[axis]), other = axis === 'x' ? 'y' : 'x';
    return { [axis]: edge, [other]: a[other] + t * (b[other] - a[other]) };
  };
  let result = points;
  for (const [axis, edge, keep] of [['x', rect.x, 1], ['x', rect.x + rect.w, -1], ['y', rect.y, 1], ['y', rect.y + rect.h, -1]]) {
    if (!result.length) break;
    result = clipEdge(result, point => (point[axis] - edge) * keep >= 0, along(axis, edge));
  }
  return result;
}

function decimate(points, maximum) {
  if (points.length <= maximum) return points;
  const step = points.length / maximum;
  return Array.from({ length: maximum }, (_, index) => points[Math.floor(index * step)]);
}

function withoutRepeats(points) {
  return points.filter((point, index) => {
    const next = points[(index + 1) % points.length];
    return points.length === 1 || point.x !== next.x || point.y !== next.y;
  });
}

/** @description Validate a region selection received from a browser, a saved request or another caller.
 * @param {object} value Candidate selection in source pixels.
 * @returns {object} Independent normalized selection; malformed, unbounded or too-small regions throw. */
export function validateSelection(value) {
  objectKeys(value, FIELDS, 'Region selection');
  demand(value.version === 1, 'Unsupported region selection version');
  demand(KINDS.has(value.kind), 'Unsupported region selection kind');
  const width = number(value.sourceWidth, 1, 8192, 'Source width'), height = number(value.sourceHeight, 1, 8192, 'Source height');
  demand(Number.isInteger(width) && Number.isInteger(height), 'Source dimensions must be whole pixels');
  demand(Array.isArray(value.points) && value.points.length >= 3 && value.points.length <= REGION_LIMITS.points, 'A region needs between 3 and 2000 outline points');
  const points = value.points.map(point => {
    objectKeys(point, ['x', 'y'], 'Region point');
    return { x: number(point.x, 0, width, 'Region x'), y: number(point.y, 0, height, 'Region y') };
  });
  demand(polygonArea(points) >= REGION_LIMITS.minArea, 'This region is too small to edit; select a larger area');
  return { version: 1, kind: value.kind, layerId: identifier(value.layerId), assetId: identifier(value.assetId),
    sourceWidth: width, sourceHeight: height, feather: number(value.feather ?? 0, 0, REGION_LIMITS.feather, 'Region feather'), points };
}

function editableImage(project, layerId) {
  const layer = project.layers.find(item => item.id === layerId);
  demand(layer, 'The selected image layer no longer exists; select the region again');
  demand(layer.type === 'image', 'Region selection works on image layers');
  demand(layer.visible, 'Show the image layer before selecting or editing a region of it');
  demand(!layer.locked, 'Unlock the image layer before selecting or editing a region of it');
  return { layer, asset: project.images[layer.assetId] };
}

function contains(layer, point) {
  const local = worldToLayer(layer, point);
  return local.x >= 0 && local.x <= layer.w && local.y >= 0 && local.y <= layer.h;
}

/** @description Choose the image layer a region applies to: the selected layer, or the single image under the pointer.
 * @param {object} project Layered project.
 * @param {string|null} selectedId Currently selected layer ID.
 * @param {{x:number,y:number}} point Canvas point where the region starts.
 * @returns {object} The target image layer; no image, or several stacked images with none selected, throws. */
export function targetImageLayer(project, selectedId, point) {
  const current = validateProject(project), selected = current.layers.find(layer => layer.id === selectedId);
  if (selected) return editableImage(current, selected.id).layer;
  const candidates = current.layers.filter(layer => layer.type === 'image' && layer.visible && !layer.locked && contains(layer, point));
  demand(candidates.length > 0, 'Select an image layer, then choose a region of it');
  demand(candidates.length === 1, 'More than one image is under this point; select the image layer first');
  return candidates[0];
}

function fromSourceOutline(kind, layer, asset, outline, feather) {
  const clipped = withoutRepeats(clipToRect(outline, visibleSourceRect(layer, asset)).map(point => ({ x: round(point.x), y: round(point.y) })));
  demand(clipped.length >= 3, 'Draw the region over the visible part of the image');
  const points = decimate(clipped, REGION_LIMITS.points).map(point => ({ x: Math.min(asset.width, Math.max(0, point.x)), y: Math.min(asset.height, Math.max(0, point.y)) }));
  return validateSelection({ version: 1, kind, layerId: layer.id, assetId: layer.assetId, sourceWidth: asset.width, sourceHeight: asset.height, feather, points });
}

/** @description Turn a drawn canvas outline (lasso) or a dragged box into a source-pixel region of one image layer.
 * @param {object} project Layered project.
 * @param {string} layerId Target image layer.
 * @param {{x:number,y:number}[]} canvasPoints Lasso vertices, or the two opposite box corners when kind is box.
 * @param {{kind?:string,feather?:number}} options Region kind (lasso or box) and inward feather.
 * @returns {object} Validated selection clipped to what the layer shows. */
export function selectionFromCanvas(project, layerId, canvasPoints, options = {}) {
  const kind = options.kind ?? 'lasso', current = validateProject(project), { layer, asset } = editableImage(current, layerId);
  demand(kind === 'lasso' || kind === 'box', 'Unsupported region selection kind');
  demand(Array.isArray(canvasPoints) && canvasPoints.length >= (kind === 'box' ? 2 : 3), 'Draw a larger region');
  const outline = kind === 'box'
    ? [canvasPoints[0], { x: canvasPoints[1].x, y: canvasPoints[0].y }, canvasPoints[1], { x: canvasPoints[0].x, y: canvasPoints[1].y }]
    : canvasPoints;
  return fromSourceOutline(kind, layer, asset, outline.map(point => canvasToSource(layer, asset, point)), options.feather ?? 0);
}

/** @description Select everything an image layer currently shows (object selection).
 * @param {object} project Layered project.
 * @param {string} layerId Target image layer.
 * @returns {object} Validated whole-image selection. */
export function selectionFromLayer(project, layerId) {
  const { layer, asset } = editableImage(validateProject(project), layerId), rect = visibleSourceRect(layer, asset);
  const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
  return fromSourceOutline('layer', layer, asset, corners, 0);
}

/** @description Re-check a stored selection against the current document before it is shown or used.
 * @param {object} project Current layered project.
 * @param {object} selection Previously made selection.
 * @returns {{selection:object,layer:object,asset:object,canvasPoints:object[],bounds:object}} Usable region; a stale one throws a reason. */
export function resolveSelection(project, selection) {
  const normalized = validateSelection(selection), current = validateProject(project);
  const { layer, asset } = editableImage(current, normalized.layerId);
  demand(layer.assetId === normalized.assetId && asset.width === normalized.sourceWidth && asset.height === normalized.sourceHeight,
    'The image changed since this region was selected; select the region again');
  const rect = visibleSourceRect(layer, asset), tolerance = 0.02;
  demand(normalized.points.every(point => point.x >= rect.x - tolerance && point.x <= rect.x + rect.w + tolerance
    && point.y >= rect.y - tolerance && point.y <= rect.y + rect.h + tolerance), 'The crop changed since this region was selected; select the region again');
  return { selection: normalized, layer, asset, canvasPoints: normalized.points.map(point => sourceToCanvas(layer, asset, point)), bounds: selectionBounds(normalized.points) };
}

/** @description Bounded, pixel-free description of a region for status text and read-only assistant context.
 * @param {object} selection Validated selection.
 * @returns {{kind:string,layerId:string,x:number,y:number,width:number,height:number,area:number,points:number}} Summary. */
export function selectionSummary(selection) {
  const bounds = selectionBounds(selection.points);
  return { kind: selection.kind, layerId: selection.layerId, x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h,
    area: Math.round(polygonArea(selection.points)), points: selection.points.length };
}
