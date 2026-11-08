/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Border-seeded foreground subject cutout storing a new owned RGBA PNG asset while preserving the original (RP-PUB-03).
 */
import {spawnSync} from 'node:child_process';
import {deflateSync, inflateSync} from 'node:zlib';
import {access} from './authorization.mjs';
import {exact, fail, key, number, title} from './model.mjs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePngPure(data) {
  if (data.length < 33 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idats = [];
  while (offset + 8 <= data.length) {
    const len = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const body = data.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') idats.push(body);
    else if (type === 'IEND') break;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) return null;
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = inflateSync(Buffer.concat(idats));
  if (inflated.length < (stride + 1) * height) return null;
  const recon = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1, rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[rowIn + x];
      const a = x >= bpp ? recon[rowOut + x - bpp] : 0;
      const b = y > 0 ? recon[rowOut - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? recon[rowOut - stride + x - bpp] : 0;
      const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? ((a + b) >> 1) : filter === 4 ? paeth(a, b, c) : 0;
      recon[rowOut + x] = (raw + add) & 0xff;
    }
  }
  if (colorType === 6) return { width, height, rgba: recon };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
    rgba[j] = recon[i]; rgba[j + 1] = recon[i + 1]; rgba[j + 2] = recon[i + 2]; rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

function decodeViaFfmpeg(data) {
  const probe = spawnSync('/usr/bin/ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', '-'], { input: data, timeout: 10000 });
  if (probe.status !== 0) fail(422, 'publishing_image_decode_failed');
  const [wStr, hStr] = probe.stdout.toString('utf8').trim().split(',');
  const width = Number(wStr), height = Number(hStr);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_000_000) fail(422, 'publishing_image_decode_failed');
  const dec = spawnSync('/usr/bin/ffmpeg', ['-v', 'error', '-threads', '1', '-i', 'pipe:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: data, timeout: 15000, maxBuffer: width * height * 4 + 65536 });
  if (dec.status !== 0 || dec.stdout.length !== width * height * 4) fail(422, 'publishing_image_decode_failed');
  return { width, height, rgba: Buffer.from(dec.stdout) };
}

function colorDist(rgba, idx, br, bg, bb) {
  const dr = rgba[idx] - br, dg = rgba[idx + 1] - bg, db = rgba[idx + 2] - bb;
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

function dominantBorderRgb(width, height, rgba) {
  const buckets = new Map();
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] < 16) return;
    const keyStr = `${rgba[i] >> 4}:${rgba[i + 1] >> 4}:${rgba[i + 2] >> 4}`;
    const entry = buckets.get(keyStr) ?? { count: 0, r: 0, g: 0, b: 0 };
    entry.count += 1; entry.r += rgba[i]; entry.g += rgba[i + 1]; entry.b += rgba[i + 2];
    buckets.set(keyStr, entry);
  };
  for (let x = 0; x < width; x++) { sample(x, 0); sample(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { sample(0, y); sample(width - 1, y); }
  let best = null;
  for (const v of buckets.values()) if (!best || v.count > best.count) best = v;
  if (!best) fail(422, 'publishing_subject_not_detected');
  return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
}

export function extractSubjectRgba(width, height, sourceRgba, threshold = 42) {
  if (width < 4 || height < 4) fail(422, 'publishing_subject_not_detected');
  const rgba = Buffer.from(sourceRgba);
  const [br, bg, bb] = dominantBorderRgb(width, height, rgba);
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const pushSeed = (x, y) => {
    const p = y * width + x;
    if (visited[p]) return;
    if (colorDist(rgba, p * 4, br, bg, bb) <= threshold) {
      visited[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) { pushSeed(x, 0); pushSeed(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { pushSeed(0, y); pushSeed(width - 1, y); }

  while (head < tail) {
    const p = queue[head++];
    rgba[p * 4 + 3] = 0;
    const x = p % width, y = (p - x) / width;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const np = ny * width + nx;
      if (visited[np]) continue;
      const dist = colorDist(rgba, np * 4, br, bg, bb);
      if (dist <= threshold) {
        visited[np] = 1;
        queue[tail++] = np;
      } else if (dist <= threshold * 1.45) {
        const ramp = Math.round(255 * ((dist - threshold) / (threshold * 0.45)));
        rgba[np * 4 + 3] = Math.min(rgba[np * 4 + 3], Math.max(24, ramp));
      }
    }
  }
  const foregroundPixels = total - tail;
  if (tail === 0 || foregroundPixels < Math.max(4, Math.floor(total * 0.01))) {
    fail(422, 'publishing_subject_not_detected');
  }
  return { rgba, transparentPixels: tail, foregroundPixels };
}

export async function removeAssetBackground(store, ctx, assetId, input) {
  key(assetId);
  exact(input, ['requestKey'], ['title', 'threshold']);
  await access(ctx, 'asset.read');
  await access(ctx, 'asset.import');
  const threshold = input.threshold !== undefined ? number(input.threshold, 8, 120) : 42;
  const source = await store.assetContent(assetId, 'asset.read');
  let decoded = source.mime === 'image/png' ? decodePngPure(source.data) : null;
  if (!decoded) decoded = decodeViaFfmpeg(source.data);
  const { rgba, transparentPixels, foregroundPixels } = extractSubjectRgba(decoded.width, decoded.height, decoded.rgba, threshold);
  const pngBytes = encodeRgbaPng(decoded.width, decoded.height, rgba);
  const nextTitle = input.title !== undefined ? title(input.title) : title(`${source.title.slice(0, 140)} (cutout)`);
  const uploaded = await store.upload({ title: nextTitle, data: pngBytes, mime: 'image/png', requestKey: input.requestKey });
  return { ...uploaded, sourceAssetId: assetId, transparentPixels, foregroundPixels };
}
