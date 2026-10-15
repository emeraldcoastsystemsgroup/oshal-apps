/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Stream closed portable editable archives with exact native JSON and verified raster members; never extract caller paths.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Supply bounded safe-name frame archive members for the real render producer.
 */
import { createHash } from 'node:crypto';
import { parseNative, stringifyNative } from '../tools/native-json.mjs';
import { MotionError, LIMITS } from './project-store.mjs';
export const BUNDLE_LIMITS = Object.freeze({ archiveBytes: 264 * 1024 * 1024, manifestBytes: 32768, chunkBytes: 65536 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new MotionError(400, code); };
const uid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const utf8 = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('motion_bundle_invalid_utf8'); } };
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail('motion_bundle_invalid_manifest');
}
export function validateManifest(value) {
  fields(value, ['format','version','title','document','assets']);
  if (value.format !== 'oshal-motion-bundle' || value.version !== 1 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > LIMITS.title) fail('motion_bundle_invalid_manifest');
  fields(value.document, ['path','bytes','sha256']);
  if (value.document.path !== 'document.ecproj' || !Number.isSafeInteger(value.document.bytes) || value.document.bytes < 1 || value.document.bytes > LIMITS.documentBytes || !hash(value.document.sha256)) fail('motion_bundle_invalid_manifest');
  if (!Array.isArray(value.assets) || value.assets.length > LIMITS.references) fail('motion_bundle_invalid_manifest');
  const ids = new Set(); let total = 0;
  for (const asset of value.assets) {
    fields(asset, ['id','path','type','width','height','bytes','sha256']);
    if (!uid(asset.id) || ids.has(asset.id) || asset.path !== 'assets/' + asset.id + '.png' || asset.type !== 'image/png'
        || ![asset.width, asset.height].every(n => Number.isSafeInteger(n) && n >= 1 && n <= LIMITS.dimension) || asset.width * asset.height > LIMITS.pixels
        || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > LIMITS.imageBytes || !hash(asset.sha256)) fail('motion_bundle_invalid_manifest');
    ids.add(asset.id); total += asset.bytes;
  }
  if (total > LIMITS.assetBytes) fail('motion_bundle_invalid_manifest');
  return value;
}
function uniqueKeys(text) {
  let offset = 0;
  const space = () => { while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++; };
  function string() {
    const start = offset++;
    while (offset < text.length) { const char = text[offset++]; if (char === '\\') offset++; else if (char === '"') return JSON.parse(text.slice(start, offset)); }
    fail('motion_bundle_invalid_json');
  }
  function value(depth) {
    if (depth > 128) fail('motion_bundle_json_depth'); space();
    if (text[offset] === '{') {
      offset++; const keys = new Set(); space(); if (text[offset] === '}') { offset++; return; }
      for (;;) {
        space(); const key = string(); if (keys.has(key)) fail('motion_bundle_duplicate_key'); keys.add(key);
        space(); offset++; value(depth + 1); space(); if (text[offset++] === '}') return;
      }
    } else if (text[offset] === '[') {
      offset++; space(); if (text[offset] === ']') { offset++; return; }
      for (;;) { value(depth + 1); space(); if (text[offset++] === ']') return; }
    } else if (text[offset] === '"') string();
    else while (offset < text.length && !/[,}\]\s]/.test(text[offset])) offset++;
  }
  value(0); space(); if (offset !== text.length) fail('motion_bundle_invalid_json');
}
function header(name, bytes) {
  const block = Buffer.alloc(512), octal = (offset, size, value) => block.write(value.toString(8).padStart(size - 1, '0') + '\0', offset, size, 'ascii');
  block.write(name, 0, 100, 'ascii'); octal(100, 8, 0o600); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, bytes); octal(136, 12, 0);
  block.fill(32, 148, 156); block[156] = 48; block.write('ustar\0', 257, 6, 'ascii'); block.write('00', 263, 2, 'ascii');
  const checksum = block.reduce((sum, byte) => sum + byte, 0); block.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii'); return block;
}
function parseHeader(block) {
  if (block.length !== 512) fail('motion_bundle_truncated');
  const octal = (offset, size) => {
    if (block.subarray(offset, offset + size).some(byte => byte > 127)) fail('motion_bundle_invalid_header');
    const value = block.subarray(offset, offset + size).toString('ascii').replace(/[\0 ]+$/, '').replace(/^ +/, '');
    if (!/^[0-7]+$/.test(value)) fail('motion_bundle_invalid_header'); const n = parseInt(value, 8); if (!Number.isSafeInteger(n)) fail('motion_bundle_invalid_header'); return n;
  };
  const sum = block.reduce((total, byte, n) => total + (n >= 148 && n < 156 ? 32 : byte), 0);
  if (octal(148, 8) !== sum || !block.subarray(257, 263).equals(Buffer.from('ustar\0','ascii')) || !block.subarray(263, 265).equals(Buffer.from('00','ascii'))
      || ![0,48].includes(block[156]) || block.subarray(157, 257).some(Boolean) || block.subarray(345, 512).some(Boolean)) fail('motion_bundle_invalid_header');
  if (block.subarray(0, 100).some(byte => byte > 127)) fail('motion_bundle_invalid_header');
  const raw = block.subarray(0, 100), end = raw.indexOf(0), name = (end < 0 ? raw : raw.subarray(0, end)).toString('ascii');
  if (end >= 0 && raw.subarray(end).some(Boolean)) fail('motion_bundle_invalid_header');
  if (!['manifest.json','document.ecproj'].includes(name) && !/^assets\/[0-9a-f-]{36}\.png$/.test(name)) fail('motion_bundle_invalid_member');
  return { name, bytes: octal(124, 12) };
}
export async function* tarMember(name, bytes, check = async () => {}) {
  if (!['manifest.json','document.ecproj','render.json'].includes(name)
      && !/^assets\/[0-9a-f-]{36}\.png$/.test(name) && !/^frames\/frame-[0-9]{12}\.png$/.test(name)) fail('motion_bundle_invalid_member');
  if (!(bytes instanceof Uint8Array) || bytes.length > 8 * 1024 * 1024) fail('motion_bundle_member_limit');
  await check(); yield header(name, bytes.length);
  for (let offset = 0; offset < bytes.length; offset += BUNDLE_LIMITS.chunkBytes) { await check(); yield bytes.subarray(offset, offset + BUNDLE_LIMITS.chunkBytes); }
  const padding = (512 - bytes.length % 512) % 512; if (padding) { await check(); yield Buffer.alloc(padding); }
}
/** readAsset and check come only from the admitted source store, not archive/request fields. */
export async function* encodeBundle({ title, document, assets }, readAsset, check = async () => {}) {
  const documentBytes = Buffer.from(stringifyNative(document));
  const manifest = validateManifest({ format: 'oshal-motion-bundle', version: 1, title,
    document: { path: 'document.ecproj', bytes: documentBytes.length, sha256: sha(documentBytes) },
    assets: assets.map(asset => ({ ...asset, path: 'assets/' + asset.id + '.png' })) });
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); if (manifestBytes.length > BUNDLE_LIMITS.manifestBytes) fail('motion_bundle_manifest_limit');
  yield* tarMember('manifest.json', manifestBytes, check); yield* tarMember('document.ecproj', documentBytes, check);
  for (const asset of manifest.assets) {
    await check(); const source = await readAsset(asset.id);
    if (!(source instanceof Uint8Array) || source.length !== asset.bytes) fail('motion_bundle_integrity_error');
    const bytes = Buffer.from(source);
    if (sha(bytes) !== asset.sha256) fail('motion_bundle_integrity_error'); yield* tarMember(asset.path, bytes, check);
  }
  await check(); yield Buffer.alloc(1024); await check();
}
class Reader {
  constructor(source, check) {
    if (!source?.[Symbol.asyncIterator] && !source?.[Symbol.iterator]) fail('motion_bundle_invalid_stream');
    this.iterator = source[Symbol.asyncIterator]?.() ?? source[Symbol.iterator](); this.check = check;
    this.buffer = Buffer.alloc(0); this.position = 0; this.ended = false; this.total = 0; this.hasher = createHash('sha256');
  }
  async pull() {
    await this.check(); const value = await this.iterator.next(); await this.check();
    if (value.done) { this.ended = true; return false; }
    if (!(value.value instanceof Uint8Array) || !value.value.length || value.value.length > 128 * 1024) fail('motion_bundle_invalid_chunk');
    this.buffer = Buffer.from(value.value); this.position = 0; this.total += this.buffer.length;
    if (this.total > BUNDLE_LIMITS.archiveBytes) fail('motion_bundle_archive_limit'); this.hasher.update(this.buffer); return true;
  }
  async read(size, optional = false) {
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.imageBytes) fail('motion_bundle_member_limit');
    const out = Buffer.alloc(size); let offset = 0;
    while (offset < size) {
      if (this.position === this.buffer.length && !(await this.pull())) { if (!offset && optional) return null; fail('motion_bundle_truncated'); }
      const count = Math.min(size - offset, this.buffer.length - this.position);
      this.buffer.copy(out, offset, this.position, this.position + count); this.position += count; offset += count;
    }
    return out;
  }
  async entry(name, bytes) {
    const meta = parseHeader(await this.read(512));
    if (meta.name !== name || meta.bytes !== bytes) fail('motion_bundle_invalid_member');
    const body = await this.read(bytes), padding = (512 - bytes % 512) % 512;
    if (padding && (await this.read(padding)).some(Boolean)) fail('motion_bundle_invalid_padding'); return body;
  }
}
/** The decoder never writes an archive pathname to disk. It holds only declared bounded member buffers. */
export async function decodeBundle(source, check = async () => {}) {
  const reader = new Reader(source, check);
  try {
    const first = parseHeader(await reader.read(512));
    if (first.name !== 'manifest.json' || first.bytes < 1 || first.bytes > BUNDLE_LIMITS.manifestBytes) fail('motion_bundle_invalid_manifest');
    const bytes = await reader.read(first.bytes), pad = (512 - first.bytes % 512) % 512;
    if (pad && (await reader.read(pad)).some(Boolean)) fail('motion_bundle_invalid_padding');
    let manifest; try { const text = utf8(bytes), parsed = JSON.parse(text); uniqueKeys(text); manifest = validateManifest(parsed); } catch (error) { if (error instanceof MotionError) throw error; fail('motion_bundle_invalid_manifest'); }
    const docBytes = await reader.entry(manifest.document.path, manifest.document.bytes);
    if (sha(docBytes) !== manifest.document.sha256) fail('motion_bundle_integrity_error');
    let document; try { const text = utf8(docBytes); document = parseNative(text); uniqueKeys(text); } catch (error) { if (error instanceof MotionError) throw error; fail('motion_bundle_invalid_document'); }
    if (!document || typeof document !== 'object' || Array.isArray(document)) fail('motion_bundle_invalid_document');
    const assets = [];
    for (const asset of manifest.assets) {
      const data = await reader.entry(asset.path, asset.bytes);
      if (sha(data) !== asset.sha256 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('motion_bundle_integrity_error');
      assets.push({ ...asset, data });
    }
    let trailing = 0, block;
    while ((block = await reader.read(512, true)) !== null) { trailing += 512; if (block.some(Boolean) || trailing > 10240) fail('motion_bundle_invalid_trailer'); }
    if (trailing < 1024) fail('motion_bundle_truncated');
    await check(); return { manifest, document, assets, sha256: reader.hasher.digest('hex') };
  } finally { await reader.iterator.return?.(); }
}
