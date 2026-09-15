/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Decode bounded same-origin raster assets and embed them into portable layered downloads.
 */
import { demand, LIMITS, validateImageSource, validateProject } from './model-validation.mjs';

function abortError() { return new DOMException('Image loading was cancelled', 'AbortError'); }

function decode(asset, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted(); const image = new Image();
    const finish = error => {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); image.onload = null; image.onerror = null;
      if (error) { image.src = ''; reject(error); } else resolve(image);
    };
    const cancel = () => finish(abortError()), timer = setTimeout(() => finish(new Error('Image loading timed out')), 30000);
    image.onload = () => {
      const valid = image.naturalWidth === asset.width && image.naturalHeight === asset.height;
      finish(valid ? null : new Error('Image dimensions do not match the project asset'));
    };
    image.onerror = () => finish(new Error('An image asset could not be loaded'));
    signal?.addEventListener('abort', cancel, { once: true }); image.src = asset.src;
  });
}

/** @description Decode referenced assets without arbitrary external, file or SVG requests.
 * @param {object} project Layered document with canonical references or embedded raster data.
 * @param {{signal?:AbortSignal}} options Cancellation signal for UI document changes.
 * @returns {Promise<Map<string,HTMLImageElement>>} Decoded images keyed by stable asset IDs. */
export async function loadProjectImages(project, options = {}) {
  const normalized = validateProject(project), result = new Map();
  const ids = [...new Set(normalized.layers.filter(layer => layer.type === 'image').map(layer => layer.assetId))];
  for (const id of ids) { options.signal?.throwIfAborted(); result.set(id, await decode(normalized.images[id], options.signal)); }
  return result;
}

async function boundedBody(response) {
  const reader = response.body?.getReader(); demand(reader, 'Image response has no readable body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; demand(size <= LIMITS.dataBytes, 'Image is too large for a portable project'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  demand(size > 0, 'Image response was empty');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

function encoded(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

async function embed(asset, signal) {
  if (asset.src.startsWith('data:')) return asset;
  validateImageSource(asset.src, 'reference');
  const controller = new AbortController(), cancel = () => controller.abort(signal.reason ?? abortError());
  signal?.throwIfAborted(); signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Image download timed out')), 30000);
  try {
    const response = await fetch(asset.src, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal });
    demand(response.ok, `Image download failed (${response.status})`);
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    demand(['image/png', 'image/jpeg', 'image/webp'].includes(type), 'An asset response was not a supported raster image');
    const bytes = await boundedBody(response); return { ...asset, src: `data:${type};base64,${encoded(bytes)}` };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

/** @description Replace private asset references with embedded raster data for a portable layered download.
 * @param {object} project Layered document; source snapshots remain unchanged.
 * @param {{signal?:AbortSignal}} options Cancellation for authenticated same-origin image reads.
 * @returns {Promise<object>} Complete portable project; failed or denied assets reject the entire export. */
export async function makePortableProject(project, options = {}) {
  const normalized = validateProject(project), images = {};
  for (const [id, asset] of Object.entries(normalized.images)) {
    options.signal?.throwIfAborted(); images[id] = await embed(asset, options.signal);
  }
  return validateProject({ ...normalized, images });
}
