/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render editable layers with native Canvas2D, source cropping and real raster export.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Apply the saturation, grayscale, sepia and blur filters in one fixed order through the same Canvas2D filter the preview and export already share.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Render bounded source-space masks before crop and transform; preview and raster export share the same cached mask.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Integrate version 3 brush and arithmetic masks plus editable stack/clipped color adjustments with existing project history.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Integrate isolated group layers with bounded nesting, uniform transforms, ancestor locks and source-space region mapping.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Integrate editable cubic vector paths, bounded worker booleans, arrangement and explicit SVG interchange with existing private project flows.
 */
import { demand, number, validateProject, IMAGE_FILTERS } from './model-validation.mjs';
import { traceVector } from './vector-geometry.mjs';
import { parentGroup } from './group-geometry.mjs';
import { loadProjectImages } from './image-assets.mjs';
export { hitTest, worldToLayer } from './hit-test.mjs';
export { loadProjectImages, makePortableProject } from './image-assets.mjs';

function shape(ctx, layer) {
  ctx.beginPath();
  if (layer.type === 'ellipse') ctx.ellipse(layer.w / 2, layer.h / 2, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
  else ctx.rect(0, 0, layer.w, layer.h);
  ctx.fillStyle = layer.fill; ctx.fill();
  if (layer.strokeWidth > 0) { ctx.strokeStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth; ctx.stroke(); }
}

function vectorLayer(ctx, layer) {
  if (layer.clip) {
    ctx.beginPath(); layer.clip.forEach((point, index) => index ? ctx.lineTo(point.x * layer.w, point.y * layer.h) : ctx.moveTo(point.x * layer.w, point.y * layer.h));
    ctx.closePath(); ctx.clip('nonzero');
  }
  ctx.beginPath(); traceVector(ctx, layer);
  ctx.fillStyle = layer.fill;
  if (layer.gradient) {
    const { from, to, stops } = layer.gradient, gradient = ctx.createLinearGradient(from.x * layer.w, from.y * layer.h, to.x * layer.w, to.y * layer.h);
    for (const stop of stops) gradient.addColorStop(stop.offset, stop.color); ctx.fillStyle = gradient;
  }
  ctx.fill(layer.fillRule); ctx.strokeStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth;
  ctx.lineCap = layer.cap; ctx.lineJoin = layer.join; ctx.setLineDash(layer.dash);
  if (layer.strokeWidth > 0) ctx.stroke();
}

function wordsToLines(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > width) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

function textLayer(ctx, layer) {
  ctx.beginPath(); ctx.rect(0, 0, layer.w, layer.h); ctx.clip();
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
  ctx.textBaseline = 'top'; ctx.textAlign = layer.align; ctx.fillStyle = layer.fill;
  const x = layer.align === 'center' ? layer.w / 2 : layer.align === 'right' ? layer.w : 0;
  wordsToLines(ctx, layer.text, layer.w).forEach((line, index) => {
    const y = index * layer.fontSize * 1.2; if (y < layer.h) ctx.fillText(line, x, y, layer.w);
  });
}

function freehand(ctx, layer) {
  ctx.strokeStyle = layer.stroke; ctx.fillStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); const first = layer.points[0]; ctx.moveTo(first.x * layer.w, first.y * layer.h);
  for (const point of layer.points.slice(1)) ctx.lineTo(point.x * layer.w, point.y * layer.h);
  if (layer.points.length > 1) ctx.stroke();
  else { ctx.arc(first.x * layer.w, first.y * layer.h, layer.strokeWidth / 2, 0, Math.PI * 2); ctx.fill(); }
}

const CSS_FILTER = { saturation: 'saturate', grayscale: 'grayscale', sepia: 'sepia', blur: 'blur' };

/** @description Build the one Canvas2D filter string for an image layer; neutral filters are left out.
 * @param {object} layer Normalized image layer.
 * @returns {string} CSS filter list in the fixed IMAGE_FILTERS order after brightness and contrast. */
export function imageFilter(layer) {
  const parts = [`brightness(${layer.brightness}%)`, `contrast(${layer.contrast}%)`];
  for (const [name, bounds] of Object.entries(IMAGE_FILTERS)) {
    const value = layer[name] ?? bounds.neutral;
    if (value !== bounds.neutral) parts.push(`${CSS_FILTER[name]}(${value}${bounds.unit})`);
  }
  return parts.join(' ');
}

function scratch(width, height) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : globalThis.document?.createElement('canvas');
  demand(canvas, 'Image masking requires a native canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); demand(ctx, 'Image masking requires Canvas2D'); return { canvas, ctx };
}

function maskPath(ctx, points) {
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath(); ctx.fill('nonzero');
}

function editCoverage(coverage, operation) {
  const { ctx, canvas } = coverage;
  ctx.save(); ctx.globalAlpha = operation.opacity; ctx.fillStyle = ctx.strokeStyle = '#ffffff';
  try {
    if (operation.mode === 'intersect') {
      const cut = scratch(canvas.width, canvas.height); cut.ctx.fillStyle = '#ffffff'; maskPath(cut.ctx, operation.points);
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(cut.canvas, 0, 0); return;
    }
    ctx.globalCompositeOperation = operation.mode === 'subtract' ? 'destination-out' : 'source-over';
    if (operation.kind === 'polygon') { maskPath(ctx, operation.points); return; }
    ctx.lineWidth = operation.size; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath();
    const first = operation.points[0]; ctx.moveTo(first.x, first.y);
    for (const point of operation.points.slice(1)) ctx.lineTo(point.x, point.y);
    if (operation.points.length > 1) ctx.stroke();
    else { ctx.arc(first.x, first.y, operation.size / 2, 0, Math.PI * 2); ctx.fill(); }
  } finally { ctx.restore(); }
}

// Reuse only the latest mask for each decoded source; changing masks never accumulates buffers.
const maskCache = new WeakMap();
function maskedSource(image, asset, mask) {
  const signature = JSON.stringify(mask), cached = maskCache.get(image);
  if (cached?.signature === signature) return cached.canvas;
  const coverage = scratch(asset.width, asset.height), output = scratch(asset.width, asset.height);
  const ctx = coverage.ctx; ctx.fillStyle = '#ffffff'; ctx.beginPath();
  mask.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.closePath(); ctx.fill('nonzero');
  for (const operation of mask.operations ?? []) editCoverage(coverage, operation);
  output.ctx.drawImage(image, 0, 0);
  output.ctx.globalCompositeOperation = mask.inverted ? 'destination-out' : 'destination-in';
  output.ctx.filter = mask.feather ? `blur(${mask.feather}px)` : 'none';
  output.ctx.drawImage(coverage.canvas, 0, 0);
  maskCache.set(image, { signature, canvas: output.canvas }); return output.canvas;
}

function imageLayer(ctx, layer, project, images) {
  const image = images instanceof Map ? images.get(layer.assetId) : images?.[layer.assetId];
  demand(image, `Image asset ${layer.assetId} is not loaded`);
  const asset = project.images[layer.assetId], crop = layer.crop;
  const source = layer.mask?.enabled ? maskedSource(image, asset, layer.mask) : image;
  ctx.filter = imageFilter(layer);
  ctx.drawImage(source, crop.x * asset.width, crop.y * asset.height, crop.w * asset.width, crop.h * asset.height, 0, 0, layer.w, layer.h);
}

function curveValue(curve, input) {
  const upper = curve.findIndex(point => point.x >= input);
  if (upper <= 0) return curve[0].y;
  const left = curve[upper - 1], right = curve[upper];
  return left.y + (right.y - left.y) * (input - left.x) / (right.x - left.x);
}

function adjustPixels(ctx, layer) {
  const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height), data = pixels.data;
  const lut = Array.from({ length: 256 }, (_, value) => {
    const exposed = value * 2 ** layer.exposure;
    const level = Math.max(0, Math.min(1, (exposed - layer.black) / (layer.white - layer.black)));
    return curveValue(layer.curve, level ** (1 / layer.gamma)) * 255;
  });
  const saturation = layer.saturation / 100, amount = layer.opacity;
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue;
    const red = lut[data[index]], green = lut[data[index + 1]], blue = lut[data[index + 2]];
    const gray = .2126 * red + .7152 * green + .0722 * blue;
    data[index] = data[index] * (1 - amount) + Math.max(0, Math.min(255, gray + (red - gray) * saturation)) * amount;
    data[index + 1] = data[index + 1] * (1 - amount) + Math.max(0, Math.min(255, gray + (green - gray) * saturation)) * amount;
    data[index + 2] = data[index + 2] * (1 - amount) + Math.max(0, Math.min(255, gray + (blue - gray) * saturation)) * amount;
  }
  ctx.putImageData(pixels, 0, 0);
}

function paintStack(ctx, project, images, parent = null) {
  const clips = project.layers.filter(layer => layer.type === 'adjustment' && layer.scope === 'layer' && layer.visible && layer.opacity > 0);
  const layers = parent ? parent.children.map(id => project.layers.find(layer => layer.id === id)) : project.layers.filter(layer => !parentGroup(project, layer.id));
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    if (layer.type === 'adjustment') { if (layer.scope === 'stack') adjustPixels(ctx, layer); continue; }
    const adjustments = clips.filter(item => item.targetId === layer.id);
    if (!adjustments.length) { drawLayer(ctx, layer, project, images); continue; }
    const isolated = scratch(ctx.canvas.width, ctx.canvas.height);
    drawLayer(isolated.ctx, layer, project, images);
    for (const adjustment of adjustments) adjustPixels(isolated.ctx, adjustment);
    ctx.drawImage(isolated.canvas, 0, 0);
  }
}

function drawLayer(ctx, layer, project, images) {
  ctx.save();
  try {
    ctx.globalAlpha = layer.opacity; ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
    ctx.rotate(layer.rotation * Math.PI / 180); ctx.translate(-layer.w / 2, -layer.h / 2);
    if (layer.type === 'group') {
      const isolated = scratch(layer.baseWidth, layer.baseHeight); paintStack(isolated.ctx, project, images, layer);
      ctx.drawImage(isolated.canvas, 0, 0, layer.w, layer.h);
    } else if (layer.type === 'path') vectorLayer(ctx, layer);
    else if (layer.type === 'image') imageLayer(ctx, layer, project, images);
    else if (layer.type === 'text') textLayer(ctx, layer);
    else if (layer.type === 'freehand') freehand(ctx, layer);
    else shape(ctx, layer);
  } finally { ctx.restore(); }
}

/** @description Paint exactly the project composition; selection controls are deliberately outside exported pixels.
 * @param {CanvasRenderingContext2D} ctx Native 2D context.
 * @param {object} project Layered document.
 * @param {{images?:Map|object}} options Preloaded image sources keyed by asset ID.
 * @returns {HTMLCanvasElement|OffscreenCanvas} The rendered native canvas. */
export function renderProject(ctx, project, options = {}) {
  const normalized = validateProject(project); demand(ctx?.canvas && typeof ctx.drawImage === 'function', 'A Canvas2D context is required');
  if (ctx.canvas.width !== normalized.width) ctx.canvas.width = normalized.width;
  if (ctx.canvas.height !== normalized.height) ctx.canvas.height = normalized.height;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, normalized.width, normalized.height);
    ctx.fillStyle = normalized.background; ctx.fillRect(0, 0, normalized.width, normalized.height);
    paintStack(ctx, normalized, options.images);
  } finally { ctx.restore(); }
  return ctx.canvas;
}

function canvasFor(project, factory) {
  const canvas = factory ? factory(project.width, project.height) : globalThis.document?.createElement('canvas');
  demand(canvas, 'Native canvas export is unavailable'); canvas.width = project.width; canvas.height = project.height; return canvas;
}

function toBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), type, quality));
}

/** @description Export actual PNG/JPEG bytes from the same renderer without modifying editable layers.
 * @param {object} project Layered project.
 * @param {{type?:string,quality?:number,images?:Map,signal?:AbortSignal,canvasFactory?:Function}} options Export settings; JPEG composites transparent areas onto white.
 * @returns {Promise<Blob>} Encoded raster file. */
export async function exportProjectImage(project, options = {}) {
  const normalized = validateProject(project), type = options.type ?? 'image/png';
  demand(['image/png', 'image/jpeg'].includes(type), 'Choose PNG or JPEG export');
  const quality = number(options.quality ?? 0.92, 0, 1, 'JPEG quality');
  options.signal?.throwIfAborted();
  const images = options.images ?? await loadProjectImages(normalized, { signal: options.signal });
  const canvas = canvasFor(normalized, options.canvasFactory), ctx = canvas.getContext('2d');
  demand(ctx, 'Native Canvas2D is unavailable'); renderProject(ctx, normalized, { images });
  if (type === 'image/jpeg') { ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  options.signal?.throwIfAborted(); const blob = await toBlob(canvas, type, quality);
  demand(blob.type === type && blob.size > 0, 'The browser could not encode this format'); return blob;
}
