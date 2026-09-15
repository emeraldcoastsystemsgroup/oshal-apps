/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Bound portable layered documents and owner-qualified raster references before editing or rendering.
 */

/** @description Shared resource ceilings for browser edits and reference-only persistence.
 * @returns {object} Immutable numeric limits. */
export const LIMITS = Object.freeze({ dimension: 8192, pixels: 33554432, layers: 200, images: 64,
  points: 10000, totalPoints: 50000, text: 20000, dataBytes: 8388608, portableBytes: 33554432,
  referenceBytes: 262144 });
const TYPES = new Set(['image', 'text', 'rect', 'ellipse', 'freehand']);
const COMMON = ['id', 'type', 'name', 'x', 'y', 'w', 'h', 'rotation', 'opacity', 'visible', 'locked'];
const FIELDS = { image: ['assetId', 'brightness', 'contrast', 'crop'], text: ['text', 'fontFamily', 'fontSize', 'fontWeight', 'fill', 'align'],
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
    brightness: number(layer.brightness ?? 100, 0, 300, 'Brightness'), contrast: number(layer.contrast ?? 100, 0, 300, 'Contrast') };
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
  demand(project.version === 1, 'Unsupported project version');
  const width = number(project.width, 1, LIMITS.dimension, 'Canvas width'), height = number(project.height, 1, LIMITS.dimension, 'Canvas height');
  demand(Number.isInteger(width) && Number.isInteger(height) && width * height <= LIMITS.pixels, 'Canvas dimensions are too large');
  demand(Array.isArray(project.layers) && project.layers.length <= LIMITS.layers, 'Too many layers');
  const images = normalizeImages(project.images ?? {}, options.assetMode), layers = project.layers.map(normalizeLayer), ids = new Set();
  let points = 0;
  for (const layer of layers) {
    demand(!ids.has(layer.id), 'Layer IDs must be unique'); ids.add(layer.id);
    demand(layer.type !== 'image' || Object.hasOwn(images, layer.assetId), 'An image layer references a missing asset');
    points += layer.points?.length ?? 0;
  }
  demand(points <= LIMITS.totalPoints, 'Too many stroke points in this project');
  const result = { version: 1, name: text(project.name ?? 'Untitled image', 160, 'Project name'), width, height,
    background: color(project.background, 'transparent'), layers, images };
  const maximum = options.assetMode === 'reference' ? LIMITS.referenceBytes : LIMITS.portableBytes;
  demand(new TextEncoder().encode(JSON.stringify(result)).length <= maximum, 'Project is too large');
  return result;
}
