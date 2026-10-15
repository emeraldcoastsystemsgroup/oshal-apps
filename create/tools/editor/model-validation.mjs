/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bound portable layered documents and owner-qualified raster references before editing or rendering.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Admit version 2 source-space image masks; retain unmodified v1 normalization.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add four bounded image filters (saturation, grayscale, sepia, blur). A filter at its neutral value is omitted from the normalized layer, so a project that uses none keeps the exact 1.8.2 document shape and still opens in earlier releases.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Integrate version 3 brush and arithmetic masks plus editable stack/clipped color adjustments with existing project history.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 */

/** @description Shared resource ceilings for browser edits and reference-only persistence.
 * @returns {object} Immutable numeric limits. */
export const LIMITS = Object.freeze({ dimension: 8192, pixels: 33554432, layers: 200, images: 64,
  points: 10000, totalPoints: 50000, text: 20000, dataBytes: 8388608, portableBytes: 33554432,
  referenceBytes: 262144 });

/** @description The simple image filters, their inclusive bounds and the neutral value that is never stored.
 * Blur is measured in canvas pixels; the others are CSS filter percentages.
 * @returns {object} Immutable filter name to { min, max, neutral, unit } map, in render order. */
export const IMAGE_FILTERS = Object.freeze({
  saturation: Object.freeze({ min: 0, max: 300, neutral: 100, unit: '%' }),
  grayscale: Object.freeze({ min: 0, max: 100, neutral: 0, unit: '%' }),
  sepia: Object.freeze({ min: 0, max: 100, neutral: 0, unit: '%' }),
  blur: Object.freeze({ min: 0, max: 64, neutral: 0, unit: 'px' }),
});
const TYPES = new Set(['image', 'text', 'rect', 'ellipse', 'freehand', 'adjustment', 'group', 'path']);
const COMMON = ['id', 'type', 'name', 'x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'locked'];
const FIELDS = { path: ['contours', 'fill', 'stroke', 'strokeWidth', 'fillRule', 'cap', 'join', 'dash', 'gradient', 'clip', 'sourceIds'], group: ['children', 'baseWidth', 'baseHeight'], adjustment: ['scope', 'targetId', 'exposure', 'black', 'white', 'gamma', 'saturation', 'curve'], image: ['mask', 'assetId', 'brightness', 'contrast', 'crop', ...Object.keys(IMAGE_FILTERS)], text: ['text', 'fontFamily', 'fontSize', 'fontWeight', 'fill', 'align'],
  rect: ['fill', 'stroke', 'strokeWidth'], ellipse: ['fill', 'stroke', 'strokeWidth'], freehand: ['points', 'stroke', 'strokeWidth'] };

/** @description Reject invalid input with a stable, user-readable boundary error.
 * @param {boolean} condition Required condition.
 * @param {string} message Rejection explanation.
 * @returns {void} Throws when the condition is false. */
export function demand(condition, message) { if (!condition) throw new TypeError(message); }

/** @description Reject arrays, exotic objects and unknown schema fields.
 * @param {unknown} value Object to inspect.
 * @param {string[]} keys Exact allowed keys.
 * @param {string} label Error context.
 * @returns {void} Throws on unsupported structure. */
export function objectKeys(value, keys, label) {
  demand(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  demand([Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be a plain object`);
  demand(Object.keys(value).every(key => keys.includes(key)), `${label} has unsupported fields`);
}

/** @description Keep IDs safe as dictionary keys and stable across project round trips.
 * @param {unknown} value Candidate ID.
 * @returns {string} Validated ID. */
export function identifier(value) {
  demand(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value), 'Invalid layer or asset ID');
  return value;
}

/** @description Validate finite bounded numbers without coercing malformed JSON.
 * @param {unknown} value Candidate number.
 * @param {number} min Inclusive minimum.
 * @param {number} max Inclusive maximum.
 * @param {string} label Error context.
 * @returns {number} Validated number. */
export function number(value, min, max, label) {
  demand(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${label} is out of range`);
  return value;
}

function text(value, maximum, label) {
  demand(typeof value === 'string' && value.length <= maximum, `${label} is too long or not text`);
  return value;
}

function boolean(value, fallback, label) {
  if (value === undefined) return fallback;
  demand(typeof value === 'boolean', `${label} must be true or false`); return value;
}

function color(value, fallback) {
  const result = value ?? fallback;
  demand(typeof result === 'string' && /^(?:transparent|#[a-fA-F0-9]{3,4}|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8})$/.test(result), 'Use a hex color or transparent');
  return result.toLowerCase();
}

function shapeFields(layer) {
  return { fill: color(layer.fill, '#3b82f6'), stroke: color(layer.stroke, 'transparent'),
    strokeWidth: number(layer.strokeWidth ?? 0, 0, 512, 'Stroke width') };
}

function textFields(layer) {
  const family = layer.fontFamily ?? 'sans-serif', weight = layer.fontWeight ?? 400, align = layer.align ?? 'left';
  demand(typeof family === 'string' && /^[a-zA-Z][a-zA-Z0-9 -]{0,63}$/.test(family), 'Unsupported font family');
  demand(Number.isInteger(weight) && weight >= 100 && weight <= 900 && weight % 100 === 0, 'Unsupported font weight');
  demand(['left', 'center', 'right'].includes(align), 'Unsupported text alignment');
  return { text: text(layer.text ?? 'Text', LIMITS.text, 'Layer text'), fontFamily: family,
    fontSize: number(layer.fontSize ?? 32, 1, 1024, 'Font size'), fontWeight: weight, align, fill: color(layer.fill, '#111827') };
}

function freehandFields(layer) {
  demand(Array.isArray(layer.points) && layer.points.length > 0 && layer.points.length <= LIMITS.points, 'A stroke needs bounded points');
  const points = layer.points.map(point => {
    objectKeys(point, ['x', 'y'], 'Stroke point');
    return { x: number(point.x, 0, 1, 'Point x'), y: number(point.y, 0, 1, 'Point y') };
  });
  return { points, stroke: color(layer.stroke, '#111827'), strokeWidth: number(layer.strokeWidth ?? 4, 0.1, 512, 'Stroke width') };
}

function cropRectangle(value = { x: 0, y: 0, w: 1, h: 1 }) {
  objectKeys(value, ['x', 'y', 'w', 'h'], 'Image crop');
  const crop = { x: number(value.x, 0, 1, 'Crop x'), y: number(value.y, 0, 1, 'Crop y'),
    w: number(value.w, 0.0001, 1, 'Crop width'), h: number(value.h, 0.0001, 1, 'Crop height') };
  demand(crop.x + crop.w <= 1.00000001 && crop.y + crop.h <= 1.00000001, 'Crop must stay inside the source image');
  return crop;
}

/** @description Validate each present filter and drop the neutral ones, so unfiltered layers keep their earlier shape.
 * @param {object} layer Image layer candidate.
 * @returns {object} Only the non-neutral filter values. */
function imageFilterFields(layer) {
  const result = {};
  for (const [name, bounds] of Object.entries(IMAGE_FILTERS)) {
    if (layer[name] === undefined) continue;
    const value = number(layer[name], bounds.min, bounds.max, `Image ${name}`);
    if (value !== bounds.neutral) result[name] = value;
  }
  return result;
}

function normalizedPoint(point, label = 'Vector point') {
  objectKeys(point, ['x', 'y'], label); return { x: number(point.x, -8, 8, `${label} x`), y: number(point.y, -8, 8, `${label} y`) };
}

function pathFields(layer) {
  demand(Array.isArray(layer.contours) && layer.contours.length > 0 && layer.contours.length <= 128, 'A vector needs 1 to 128 contours');
  let count = 0;
  const contours = layer.contours.map(contour => {
    objectKeys(contour, ['closed', 'nodes'], 'Vector contour');
    demand(Array.isArray(contour.nodes) && contour.nodes.length >= 2 && contour.nodes.length <= 2000, 'A contour needs 2 to 2000 nodes');
    count += contour.nodes.length; demand(count <= 10000, 'A vector supports at most 10000 nodes');
    const nodes = contour.nodes.map(node => {
      objectKeys(node, ['x', 'y', 'in', 'out'], 'Vector node');
      return { x: number(node.x, 0, 1, 'Node x'), y: number(node.y, 0, 1, 'Node y'),
        in: normalizedPoint(node.in ?? { x: 0, y: 0 }), out: normalizedPoint(node.out ?? { x: 0, y: 0 }) };
    });
    return { closed: boolean(contour.closed, true, 'Closed contour'), nodes };
  });
  const cap = layer.cap ?? 'butt', join = layer.join ?? 'miter', fillRule = layer.fillRule ?? 'nonzero';
  demand(['butt', 'round', 'square'].includes(cap) && ['miter', 'round', 'bevel'].includes(join), 'Unsupported stroke cap or join');
  demand(['nonzero', 'evenodd'].includes(fillRule), 'Unsupported vector fill rule');
  const dash = layer.dash ?? []; demand(Array.isArray(dash) && dash.length <= 16, 'Stroke dash is too long');
  const result = { ...shapeFields(layer), contours, cap, join, fillRule, dash: dash.map(value => number(value, .1, 512, 'Dash length')) };
  if (layer.gradient != null) {
    const value = layer.gradient; objectKeys(value, ['from', 'to', 'stops'], 'Linear gradient');
    demand(Array.isArray(value.stops) && value.stops.length >= 2 && value.stops.length <= 16, 'A gradient needs 2 to 16 stops');
    const stops = value.stops.map(stop => { objectKeys(stop, ['offset', 'color'], 'Gradient stop'); return { offset: number(stop.offset, 0, 1, 'Gradient offset'), color: color(stop.color, '#000000') }; });
    demand(stops.every((stop, index) => !index || stop.offset >= stops[index - 1].offset), 'Gradient stops must be ordered');
    result.gradient = { from: normalizedPoint(value.from), to: normalizedPoint(value.to), stops };
  }
  if (layer.clip != null) {
    demand(Array.isArray(layer.clip) && layer.clip.length >= 3 && layer.clip.length <= 2000, 'Vector clip needs 3 to 2000 points');
    result.clip = layer.clip.map(point => normalizedPoint(point, 'Clip point'));
  }
  if (layer.sourceIds != null) { demand(Array.isArray(layer.sourceIds) && layer.sourceIds.length <= 2, 'Boolean lineage is bounded'); result.sourceIds = layer.sourceIds.map(identifier); }
  return result;
}

function groupFields(layer) {
  demand(Array.isArray(layer.children) && layer.children.length > 0 && layer.children.length <= LIMITS.layers, 'A group needs child layer IDs');
  const children = layer.children.map(identifier); demand(new Set(children).size === children.length, 'Group children must be unique');
  const baseWidth = number(layer.baseWidth, 1, LIMITS.dimension, 'Group source width');
  const baseHeight = number(layer.baseHeight, 1, LIMITS.dimension, 'Group source height');
  demand(Number.isInteger(baseWidth) && Number.isInteger(baseHeight) && baseWidth * baseHeight <= 4194304, 'Group frame must fit 4 megapixels');
  demand(Math.abs((layer.w ?? 100) / baseWidth - (layer.h ?? 100) / baseHeight) < .000001, 'Group resize must preserve its aspect ratio');
  return { children, baseWidth, baseHeight };
}

function validateGroups(layers) {
  const parents = new Map(), groups = layers.filter(layer => layer.type === 'group');
  demand(groups.length <= 16, 'A project supports at most 16 groups');
  for (const group of groups) for (const id of group.children) {
    demand(layers.some(layer => layer.id === id) && id !== group.id, 'Group child must exist and differ from its parent');
    demand(!parents.has(id), 'A layer may belong to only one group'); parents.set(id, group.id);
  }
  for (const layer of layers) {
    const visited = new Set([layer.id]); let id = parents.get(layer.id);
    while (id) { demand(!visited.has(id) && visited.size <= 4, 'Groups must be acyclic and at most four levels deep'); visited.add(id); id = parents.get(id); }
    if (layer.type === 'adjustment' && layer.scope === 'layer') demand(parents.get(layer.id) === parents.get(layer.targetId), 'Clipped adjustment and target must share a group');
  }
  return parents;
}

function adjustmentFields(layer) {
  const scope = layer.scope ?? 'stack'; demand(['stack', 'layer'].includes(scope), 'Adjustment scope must be stack or layer');
  const black = number(layer.black ?? 0, 0, 254, 'Black level'), white = number(layer.white ?? 255, 1, 255, 'White level');
  demand(black < white, 'Black level must be below white level');
  const raw = layer.curve ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  demand(Array.isArray(raw) && raw.length >= 2 && raw.length <= 32, 'Curve needs 2 to 32 points');
  const curve = raw.map(point => {
    objectKeys(point, ['x', 'y'], 'Curve point'); return { x: number(point.x, 0, 1, 'Curve input'), y: number(point.y, 0, 1, 'Curve output') };
  });
  demand(curve[0].x === 0 && curve.at(-1).x === 1 && curve.every((point, index) => !index || point.x > curve[index - 1].x), 'Curve inputs must increase from 0 to 1');
  return { scope, ...(scope === 'layer' ? { targetId: identifier(layer.targetId) } : {}),
    exposure: number(layer.exposure ?? 0, -8, 8, 'Exposure'), black, white,
    gamma: number(layer.gamma ?? 1, .1, 10, 'Gamma'), saturation: number(layer.saturation ?? 100, 0, 300, 'Adjustment saturation'), curve };
}

function maskOperations(value = []) {
  demand(Array.isArray(value) && value.length <= 128, 'A mask supports at most 128 edits');
  return value.map(operation => {
    objectKeys(operation, ['kind', 'mode', 'points', 'size', 'opacity'], 'Mask edit');
    demand(['polygon', 'brush'].includes(operation.kind), 'Unsupported mask edit');
    demand(['add', 'subtract', 'intersect'].includes(operation.mode), 'Unsupported mask combination');
    demand(operation.kind !== 'brush' || operation.mode !== 'intersect', 'Brush uses add or subtract');
    demand(Array.isArray(operation.points) && operation.points.length >= (operation.kind === 'brush' ? 1 : 3)
      && operation.points.length <= 2000, 'Mask edit needs bounded points');
    const points = operation.points.map(point => {
      objectKeys(point, ['x', 'y'], 'Mask edit point');
      return { x: number(point.x, 0, LIMITS.dimension, 'Mask x'), y: number(point.y, 0, LIMITS.dimension, 'Mask y') };
    });
    return { kind: operation.kind, mode: operation.mode, points,
      size: number(operation.size ?? 20, 1, 512, 'Mask brush size'), opacity: number(operation.opacity ?? 1, 0.01, 1, 'Mask edit opacity') };
  });
}

/** @description Keep an editable polygon mask in original source pixels with bounded feathering.
 * @param {object|null} value Mask or null to remove it.
 * @returns {object|undefined} Independent normalized mask. */
function imageMask(value) {
  if (value == null) return undefined;
  objectKeys(value, ['points', 'enabled', 'inverted', 'feather', 'operations'], 'Image mask');
  demand(Array.isArray(value.points) && value.points.length >= 3 && value.points.length <= 2000, 'A mask needs 3 to 2000 points');
  const points = value.points.map(point => {
    objectKeys(point, ['x', 'y'], 'Mask point');
    return { x: number(point.x, 0, LIMITS.dimension, 'Mask x'), y: number(point.y, 0, LIMITS.dimension, 'Mask y') };
  });
  const operations = maskOperations(value.operations);
  return { points, ...(operations.length ? { operations } : {}), enabled: boolean(value.enabled, true, 'Mask enabled'),
    inverted: boolean(value.inverted, false, 'Mask inverted'), feather: number(value.feather ?? 0, 0, 64, 'Mask feather') };
}

/** @description Normalize one complete layer while preserving its exact ID and type.
 * @param {object} layer Layer with required ID and type; omitted presentation fields get defaults.
 * @returns {object} Independent normalized layer. */
export function normalizeLayer(layer) {
  demand(layer && TYPES.has(layer.type), 'Unsupported layer type');
  objectKeys(layer, [...COMMON, ...FIELDS[layer.type]], 'Layer');
  const rotation = number(layer.rotation ?? 0, -360000, 360000, 'Rotation');
  const result = { id: identifier(layer.id), type: layer.type, name: text(layer.name ?? layer.type, 120, 'Layer name'),
    x: number(layer.x ?? 0, -32768, 32768, 'Layer x'), y: number(layer.y ?? 0, -32768, 32768, 'Layer y'),
    w: number(layer.w ?? 100, 0.1, 32768, 'Layer width'), h: number(layer.h ?? 100, 0.1, 32768, 'Layer height'),
    rotation: ((rotation % 360) + 540) % 360 - 180, opacity: number(layer.opacity ?? 1, 0, 1, 'Opacity'),
    visible: boolean(layer.visible, true, 'Visibility'), locked: boolean(layer.locked, false, 'Lock') };
  if (layer.type === 'image') return { ...result, assetId: identifier(layer.assetId), crop: cropRectangle(layer.crop),
    brightness: number(layer.brightness ?? 100, 0, 300, 'Brightness'), contrast: number(layer.contrast ?? 100, 0, 300, 'Contrast'),
    ...imageFilterFields(layer), ...(layer.mask == null ? {} : { mask: imageMask(layer.mask) }) };
  if (layer.type === 'path') return { ...result, ...pathFields(layer) };
  if (layer.type === 'group') return { ...result, ...groupFields(layer) };
  if (layer.type === 'adjustment') return { ...result, ...adjustmentFields(layer) };
  if (layer.type === 'text') return { ...result, ...textFields(layer) };
  if (layer.type === 'freehand') return { ...result, ...freehandFields(layer) };
  return { ...result, ...shapeFields(layer) };
}

/** @description Accept only owner-qualified raster assets or bounded embedded raster data.
 * @param {string} src Candidate image source.
 * @param {string} assetMode Use reference to forbid embedded data on server saves.
 * @returns {string} Validated source. */
export function validateImageSource(src, assetMode = 'portable') {
  demand(typeof src === 'string', 'Image source must be text');
  if (/^\/api\/create\/project-assets\/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(src)) return src;
  demand(assetMode !== 'reference', 'Save image uploads before saving the project');
  demand(src.length <= Math.ceil(LIMITS.dataBytes / 3) * 4 + 32, 'Embedded image is too large');
  const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(src);
  demand(match && match[2].length % 4 === 0 && match[2].length <= Math.ceil(LIMITS.dataBytes / 3) * 4, 'Unsupported or oversized embedded image');
  return src;
}

function normalizeImages(images, assetMode) {
  objectKeys(images, Object.keys(images ?? {}), 'Images');
  demand(Object.keys(images).length <= LIMITS.images, 'Too many image assets');
  let totalPixels = 0;
  return Object.fromEntries(Object.entries(images).map(([id, asset]) => {
    identifier(id); objectKeys(asset, ['src', 'width', 'height'], 'Image asset');
    const width = number(asset.width, 1, LIMITS.dimension, 'Image width'), height = number(asset.height, 1, LIMITS.dimension, 'Image height');
    demand(Number.isInteger(width) && Number.isInteger(height) && width * height <= LIMITS.pixels, 'Image dimensions are too large');
    totalPixels += width * height; demand(totalPixels <= LIMITS.pixels, 'Total decoded image size is too large');
    return [id, { src: validateImageSource(asset.src, assetMode), width, height }];
  }));
}

/** @description Validate and copy a complete v1 project, including references and resource budgets.
 * @param {object} project Candidate portable layered document.
 * @param {{assetMode?:string}} options Reference mode enforces the smaller persisted-document budget.
 * @returns {object} Independent normalized project; invalid input throws. */
export function validateProject(project, options = {}) {
  demand(['portable', 'reference'].includes(options.assetMode ?? 'portable'), 'Unsupported asset mode');
  objectKeys(project, ['version', 'name', 'width', 'height', 'background', 'layers', 'images'], 'Project');
  demand([1, 2, 3].includes(project.version), 'Unsupported project version');
  demand(project.version !== 1 || !project.layers?.some(layer => layer?.mask != null), 'Image masks require project version 2');
  demand(project.version >= 3 || !project.layers?.some(layer => layer?.mask?.operations?.length || ['adjustment', 'group', 'path'].includes(layer?.type)), 'Mask edits require project version 3');
  const width = number(project.width, 1, LIMITS.dimension, 'Canvas width'), height = number(project.height, 1, LIMITS.dimension, 'Canvas height');
  demand(Number.isInteger(width) && Number.isInteger(height) && width * height <= LIMITS.pixels, 'Canvas dimensions are too large');
  demand(Array.isArray(project.layers) && project.layers.length <= LIMITS.layers, 'Too many layers');
  demand(!project.layers.some(layer => ['adjustment', 'group'].includes(layer.type)) || width * height <= 4194304, 'Adjustment canvases are limited to 4 megapixels');
  const images = normalizeImages(project.images ?? {}, options.assetMode), layers = project.layers.map(normalizeLayer), ids = new Set();
  const parents = validateGroups(layers);
  let points = 0;
  for (const layer of layers) {
    demand(!ids.has(layer.id), 'Layer IDs must be unique'); ids.add(layer.id);
    demand(layer.type !== 'image' || Object.hasOwn(images, layer.assetId), 'An image layer references a missing asset');
    if (layer.type === 'adjustment' && layer.scope === 'layer') {
      const target = layers.find(item => item.id === layer.targetId);
      demand(target && target.type !== 'adjustment' && (parents.has(layer.id)
        ? layers.find(item => item.id === parents.get(layer.id)).children.indexOf(target.id) < layers.find(item => item.id === parents.get(layer.id)).children.indexOf(layer.id)
        : layers.indexOf(target) < layers.indexOf(layer)), 'Clipped adjustment must name a lower paint layer');
    }
    points += (layer.contours?.reduce((sum, contour) => sum + contour.nodes.length, 0) ?? 0) + (layer.clip?.length ?? 0);
    points += (layer.points?.length ?? 0) + (layer.mask?.points.length ?? 0) + (layer.mask?.operations?.reduce((sum, operation) => sum + operation.points.length, 0) ?? 0);
    if (layer.mask) {
      const asset = images[layer.assetId];
      demand(asset.width * asset.height <= 4194304, 'Masked source images are limited to 4 megapixels');
      demand([...layer.mask.points, ...(layer.mask.operations ?? []).flatMap(operation => operation.points)].every(point => point.x <= asset.width && point.y <= asset.height), 'Mask must stay inside the source image');
      const area = layer.mask.points.reduce((sum, point, index, all) => {
        const next = all[(index + 1) % all.length]; return sum + point.x * next.y - next.x * point.y;
      }, 0);
      demand(Math.abs(area) >= 2, 'Mask must cover at least one source pixel');
    }
  }
  demand(points <= LIMITS.totalPoints, 'Too many stroke points in this project');
  const result = { version: project.version, name: text(project.name ?? 'Untitled image', 160, 'Project name'), width, height,
    background: color(project.background, 'transparent'), layers, images };
  const maximum = options.assetMode === 'reference' ? LIMITS.referenceBytes : LIMITS.portableBytes;
  demand(new TextEncoder().encode(JSON.stringify(result)).length <= maximum, 'Project is too large');
  return result;
}
