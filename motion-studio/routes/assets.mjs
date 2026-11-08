/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Normalize real raster pixels and resolve only original-actor asset bytes for the compositor.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | RP-MOT-01: sniff bounded video and audio containers and attach staged raw byte handles for media assets over 2 MiB.
 */
import { createRequire } from 'node:module';
import { MotionError, LIMITS } from './project-store.mjs';

const require = createRequire(import.meta.url);
export const RAW_ASSET_BYTES = Symbol.for('oshal.motion.rawAssetBytes');
const MAX_INLINE_ASSET = 2 * 1024 * 1024;
const MAX_INLINE_TOTAL = 4 * 1024 * 1024;

export function sniffMediaType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  const ascii = (from, to) => Buffer.from(bytes.subarray(from, to)).toString('ascii');
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind: 'audio', ext: 'wav', type: 'audio/wav' };
  if (bytes.length >= 12 && ['FORM', 'RIFF'].includes(ascii(0, 4)) && ['AIFF', 'AIFC'].includes(ascii(8, 12))) return { kind: 'audio', ext: 'aiff', type: 'audio/aiff' };
  if (ascii(0, 4) === 'OggS') return { kind: 'audio', ext: 'ogg', type: 'audio/ogg' };
  if (ascii(0, 4) === 'fLaC') return { kind: 'audio', ext: 'flac', type: 'audio/flac' };
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] & 0xf0) !== 0xf0)) {
    return { kind: 'audio', ext: 'mp3', type: 'audio/mpeg' };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { kind: 'video', ext: 'webm', type: 'video/webm' };
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'qt  ') return { kind: 'video', ext: 'mov', type: 'video/quicktime' };
    if (['M4A ', 'M4B ', 'M4P '].includes(brand)) return { kind: 'audio', ext: 'm4a', type: 'audio/mp4' };
    return { kind: 'video', ext: 'mp4', type: 'video/mp4' };
  }
  return null;
}

export function makeEngineAsset(id, sha256, bytes, inlineBudget = { used: 0 }) {
  const buf = Buffer.from(bytes);
  if (buf.length <= MAX_INLINE_ASSET && inlineBudget.used + buf.length <= MAX_INLINE_TOTAL) {
    inlineBudget.used += buf.length;
    return { id, sha256, data: buf.toString('base64') };
  }
  const entry = { id, sha256 };
  Object.defineProperty(entry, RAW_ASSET_BYTES, { value: buf });
  return entry;
}

export async function decodeRaster(bytes) {
  let sharp;
  try { sharp = require('sharp'); } catch { throw new MotionError(503, 'motion_raster_decoder_unavailable'); }
  try {
    const metadata = await sharp(bytes, { limitInputPixels: LIMITS.pixels, failOn: 'error' }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('unsupported');
    const { data, info } = await sharp(bytes, { limitInputPixels: LIMITS.pixels, failOn: 'error' }).rotate().toColourspace('srgb').png().toBuffer({ resolveWithObject: true });
    return { bytes: data, type: 'image/png', width: info.width, height: info.height };
  } catch {
    throw new MotionError(400, 'motion_raster_refused');
  }
}

export async function ownedAssets(document, store, extras = []) {
  const ids = new Set(extras);
  for (const item of Object.values(document.items ?? {})) {
    if (item?.kind?.type !== 'Footage') continue;
    const match = typeof item.kind.path === 'string' && /^oshal-asset:([^@]+)@[0-9a-f]{64}$/.exec(item.kind.path);
    if (!match) throw new MotionError(400, 'motion_owned_source_required');
    ids.add(match[1]);
  }
  if (ids.size > LIMITS.references) throw new MotionError(413, 'motion_asset_reference_limit');
  let total = 0;
  const inlineBudget = { used: 0 }, result = [];
  for (const id of ids) {
    const asset = await store.asset(id);
    total += asset.bytes.length;
    if (total > (LIMITS.sessionBytes ?? 201326592)) throw new MotionError(413, 'motion_asset_transport_limit');
    result.push(makeEngineAsset(id, asset.sha256, asset.bytes, inlineBudget));
  }
  return result;
}
