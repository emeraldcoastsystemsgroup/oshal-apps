/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render editable layers with native Canvas2D, source cropping and real raster export.
 */
import { demand, number, validateProject } from './model-validation.mjs';
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

function imageLayer(ctx, layer, project, images) {
  const image = images instanceof Map ? images.get(layer.assetId) : images?.[layer.assetId];
  demand(image, `Image asset ${layer.assetId} is not loaded`);
  const asset = project.images[layer.assetId], crop = layer.crop;
  ctx.filter = `brightness(${layer.brightness}%) contrast(${layer.contrast}%)`;
  ctx.drawImage(image, crop.x * asset.width, crop.y * asset.height, crop.w * asset.width, crop.h * asset.height, 0, 0, layer.w, layer.h);
}

function drawLayer(ctx, layer, project, images) {
  ctx.save();
  try {
    ctx.globalAlpha = layer.opacity; ctx.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
    ctx.rotate(layer.rotation * Math.PI / 180); ctx.translate(-layer.w / 2, -layer.h / 2);
    if (layer.type === 'image') imageLayer(ctx, layer, project, images);
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
    for (const layer of normalized.layers) if (layer.visible && layer.opacity > 0) drawLayer(ctx, layer, normalized, options.images);
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
