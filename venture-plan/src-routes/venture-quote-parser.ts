/**
 * Venture engine — pure deterministic supplier quote document parser.
 *
 * Parses bounded text, CSV, Markdown, EML, and selectable-text PDF supplier quote
 * documents into candidate structured fields without calling a language model,
 * reading a clock, performing network I/O, or using floating-point money math.
 *
 * Every parsed document lands in the Saved-quote inbox as `pending` for explicit
 * human review and promotion. Image-only PDFs never crash or fabricate figures;
 * they honestly note that no selectable text was found.
 *
 * Pure module: zero external Node imports (only sibling engine modules), byte-
 * identical deterministic output, exact FIPS 180-4 SHA-256 over attached bytes,
 * and exact BigInt decimal-to-micro-currency (1e-6) parsing.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial pure deterministic quote document parser: bounded bytes/text decoding, pure SHA-256, uncompressed and FlateDecode PDF text extraction, CSV/key-value/prose extraction, exact integer micro-currency parsing, and plain-English extraction notes.
 *
 * @module venture-quote-parser
 */

import { MAX_SAFE_MICROS } from './venture-primitives';

/** Maximum raw binary attachment size (2 MiB). */
export const MAX_QUOTE_RAW_BYTES = 2 * 1024 * 1024;
/** Maximum plain-text payload size (128 KiB). */
export const MAX_QUOTE_TEXT_BYTES = 128 * 1024;
/** Maximum persisted excerpt length in characters. */
export const MAX_EXCERPT_CHARS = 4000;
/** Supported Incoterms recognized deterministically. */
export const SUPPORTED_INCOTERMS: readonly string[] = Object.freeze([
  'EXW', 'FOB', 'CIF', 'DDP', 'DAP', 'FCA',
]);

/** Honest note emitted when a PDF has no selectable text layer. */
export const PDF_NO_TEXT_NOTE = 'No selectable text found — enter extracted figures below';

/** Typed fail-closed error for saved-quote inbox parsing and transitions. */
export class QuoteInboxError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'QuoteInboxError';
  }
}

/** Input shape accepted by `parseQuoteDocument`. */
export interface QuoteDocumentInput {
  filename: string;
  mimeType?: string | null;
  textContent?: string | null;
  base64Bytes?: string | null;
}

/** Candidate structured fields extracted deterministically for operator review. */
export interface ExtractedQuoteFields {
  vendorName: string | null;
  itemLabel: string | null;
  unitPriceMicros: number | null;
  currency: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  quoteRef: string | null;
  extractionNotes: string[];
}

/** Complete deterministic parse output ready for `venture_quote_inbox`. */
export interface ParsedQuoteDocument {
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  rawExcerpt: string;
  extracted: ExtractedQuoteFields;
}

/* ══ 1. Pure FIPS 180-4 SHA-256 (zero external imports) ══════════════════ */

const SHA256_K: readonly number[] = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_IV: readonly number[] = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Pad(bytes: Uint8Array): Uint8Array {
  const bitLen = BigInt(bytes.length) * 8n;
  const rem = (bytes.length + 9) % 64;
  const padded = new Uint8Array(bytes.length + 9 + (rem === 0 ? 0 : 64 - rem));
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Number((bitLen >> 32n) & 0xffffffffn), false);
  view.setUint32(padded.length - 4, Number(bitLen & 0xffffffffn), false);
  return padded;
}

function sha256CompressBlock(state: Uint32Array, view: DataView, offset: number, w: Uint32Array): void {
  for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
  for (let i = 16; i < 64; i += 1) {
    const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = state;
  for (let i = 0; i < 64; i += 1) {
    const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
    const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0;
    d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
  state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
}

/** Compute exact lowercase 64-hex FIPS 180-4 SHA-256 digest of bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  const padded = sha256Pad(bytes);
  const view = new DataView(padded.buffer);
  const state = Uint32Array.from(SHA256_IV);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    sha256CompressBlock(state, view, off, w);
  }
  let hex = '';
  for (let i = 0; i < 8; i += 1) hex += state[i].toString(16).padStart(8, '0');
  return hex;
}

/* ══ 2. Pure UTF-8 & Base64 codecs ═══════════════════════════════════════ */

const UTF8_ENC = new TextEncoder();
const UTF8_DEC = new TextDecoder('utf-8', { fatal: false });
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LUT = new Int16Array(128).fill(-1);
for (let i = 0; i < B64_ALPHABET.length; i += 1) B64_LUT[B64_ALPHABET.charCodeAt(i)] = i;

/** Decode strict base64 string (stripping ASCII whitespace) into exact bytes. */
export function decodeBase64Bytes(raw: string, maxBytes = MAX_QUOTE_RAW_BYTES): Uint8Array {
  const clean = raw.replace(/[\r\n\t ]+/g, '');
  if (!clean || clean.length % 4 !== 0) {
    throw new QuoteInboxError('quote_document_invalid_base64', 'base64Bytes must be valid padded base64');
  }
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = (clean.length / 4) * 3 - pad;
  if (outLen > maxBytes) {
    throw new QuoteInboxError('quote_document_too_large', `document exceeds maximum size of ${maxBytes} bytes`);
  }
  const out = new Uint8Array(outLen);
  let pos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i); const c1 = clean.charCodeAt(i + 1);
    const c2 = clean.charCodeAt(i + 2); const c3 = clean.charCodeAt(i + 3);
    const v0 = c0 < 128 ? B64_LUT[c0] : -1;
    const v1 = c1 < 128 ? B64_LUT[c1] : -1;
    const isPad2 = c2 === 61 && i + 4 === clean.length && c3 === 61;
    const isPad3 = c3 === 61 && i + 4 === clean.length;
    const v2 = isPad2 ? 0 : (c2 < 128 ? B64_LUT[c2] : -1);
    const v3 = isPad3 ? 0 : (c3 < 128 ? B64_LUT[c3] : -1);
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) {
      throw new QuoteInboxError('quote_document_invalid_base64', 'base64Bytes contains illegal characters');
    }
    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (pos < outLen) out[pos++] = (triple >>> 16) & 0xff;
    if (pos < outLen) out[pos++] = (triple >>> 8) & 0xff;
    if (pos < outLen) out[pos++] = triple & 0xff;
  }
  return out;
}

/* ══ 3. Pure RFC 1951 DEFLATE/zlib inflate for FlateDecode PDF streams ═══ */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface BitReader { data: Uint8Array; bytePos: number; bitBuf: number; bitCount: number; }
interface HuffTable { counts: Int32Array; symbols: Int32Array; maxLen: number; }

function readBits(r: BitReader, n: number): number {
  while (r.bitCount < n) {
    if (r.bytePos >= r.data.length) return -1;
    r.bitBuf |= r.data[r.bytePos++] << r.bitCount;
    r.bitCount += 8;
  }
  const val = r.bitBuf & ((1 << n) - 1);
  r.bitBuf >>>= n;
  r.bitCount -= n;
  return val;
}

function buildHuffman(lengths: Int32Array): HuffTable | null {
  const counts = new Int32Array(16);
  let maxLen = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const l = lengths[i];
    if (l > 15) return null;
    if (l > 0) { counts[l] += 1; if (l > maxLen) maxLen = l; }
  }
  const offsets = new Int32Array(16);
  for (let i = 1; i < 15; i += 1) offsets[i + 1] = offsets[i] + counts[i];
  const symbols = new Int32Array(lengths.length);
  for (let sym = 0; sym < lengths.length; sym += 1) {
    const l = lengths[sym];
    if (l > 0) symbols[offsets[l]++] = sym;
  }
  return { counts, symbols, maxLen };
}

function decodeHuff(r: BitReader, t: HuffTable): number {
  let code = 0; let first = 0; let index = 0;
  for (let len = 1; len <= t.maxLen; len += 1) {
    const bit = readBits(r, 1);
    if (bit < 0) return -1;
    code |= bit;
    const count = t.counts[len];
    if (code - count < first) return t.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  return -1;
}

function buildFixedTables(): { lit: HuffTable; dist: HuffTable } {
  const litLens = new Int32Array(288);
  for (let i = 0; i <= 143; i += 1) litLens[i] = 8;
  for (let i = 144; i <= 255; i += 1) litLens[i] = 9;
  for (let i = 256; i <= 279; i += 1) litLens[i] = 7;
  for (let i = 280; i <= 287; i += 1) litLens[i] = 8;
  const distLens = new Int32Array(32).fill(5);
  return { lit: buildHuffman(litLens)!, dist: buildHuffman(distLens)! };
}

function readDynamicTables(r: BitReader): { lit: HuffTable; dist: HuffTable } | null {
  const hlit = readBits(r, 5) + 257;
  const hdist = readBits(r, 5) + 1;
  const hclen = readBits(r, 4) + 4;
  if (hlit > 286 || hdist > 30) return null;
  const clLens = new Int32Array(19);
  for (let i = 0; i < hclen; i += 1) clLens[CL_ORDER[i]] = readBits(r, 3);
  const clTable = buildHuffman(clLens);
  if (!clTable) return null;
  const total = hlit + hdist;
  const lens = new Int32Array(total);
  let i = 0;
  while (i < total) {
    const sym = decodeHuff(r, clTable);
    if (sym < 0) return null;
    if (sym < 16) { lens[i++] = sym; continue; }
    const rep = sym === 16 ? readBits(r, 2) + 3 : sym === 17 ? readBits(r, 3) + 3 : readBits(r, 7) + 11;
    const val = sym === 16 ? (i > 0 ? lens[i - 1] : 0) : 0;
    for (let k = 0; k < rep && i < total; k += 1) lens[i++] = val;
  }
  const lit = buildHuffman(lens.subarray(0, hlit));
  const dist = buildHuffman(lens.subarray(hlit));
  return lit && dist ? { lit, dist } : null;
}

function inflateHuffmanBlock(r: BitReader, lit: HuffTable, dist: HuffTable, out: number[], maxOut: number): boolean {
  while (out.length <= maxOut) {
    const sym = decodeHuff(r, lit);
    if (sym < 0) return false;
    if (sym < 256) { out.push(sym); continue; }
    if (sym === 256) return true;
    const li = sym - 257;
    if (li >= LEN_BASE.length) return false;
    const len = LEN_BASE[li] + (LEN_EXTRA[li] ? readBits(r, LEN_EXTRA[li]) : 0);
    const di = decodeHuff(r, dist);
    if (di < 0 || di >= DIST_BASE.length) return false;
    const distance = DIST_BASE[di] + (DIST_EXTRA[di] ? readBits(r, DIST_EXTRA[di]) : 0);
    if (distance <= 0 || distance > out.length) return false;
    for (let k = 0; k < len && out.length < maxOut; k += 1) out.push(out[out.length - distance]);
  }
  return false;
}

function inflateZlibStream(raw: Uint8Array, maxOut = MAX_QUOTE_TEXT_BYTES): Uint8Array | null {
  if (raw.length < 6) return null;
  const cmf = raw[0]; const flg = raw[1];
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) return null;
  const start = (flg & 0x20) ? 6 : 2;
  const r: BitReader = { data: raw, bytePos: start, bitBuf: 0, bitCount: 0 };
  const out: number[] = [];
  let bfinal = 0;
  while (!bfinal && out.length < maxOut) {
    bfinal = readBits(r, 1);
    const btype = readBits(r, 2);
    if (bfinal < 0 || btype < 0 || btype === 3) return null;
    if (btype === 0) {
      r.bitBuf = 0; r.bitCount = 0;
      if (r.bytePos + 4 > raw.length) return null;
      const len = raw[r.bytePos] | (raw[r.bytePos + 1] << 8);
      r.bytePos += 4;
      if (r.bytePos + len > raw.length) return null;
      for (let i = 0; i < len && out.length < maxOut; i += 1) out.push(raw[r.bytePos++]);
    } else {
      const tables = btype === 1 ? buildFixedTables() : readDynamicTables(r);
      if (!tables || !inflateHuffmanBlock(r, tables.lit, tables.dist, out, maxOut)) return null;
    }
  }
  return Uint8Array.from(out);
}

/* ══ 4. Deterministic PDF selectable-text extraction ═════════════════════ */

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function unescapePdfLiteral(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\' || i + 1 >= body.length) { out += body[i]; continue; }
    const next = body[++i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next >= '0' && next <= '7') {
      let oct = next;
      if (i + 1 < body.length && body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
      if (i + 1 < body.length && body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
    } else {
      out += next;
    }
  }
  return out;
}

function extractPdfOperators(content: string): string {
  const chunks: string[] = [];
  const btRe = /BT[\s\S]*?ET/g;
  const blocks = content.match(btRe) || [];
  for (const block of blocks) {
    const litRe = /\((?:\\.|[^\\()])*\)/g;
    const parts: string[] = [];
    let m: RegExpExecArray | null = litRe.exec(block);
    while (m) {
      parts.push(unescapePdfLiteral(m[0].slice(1, -1)));
      m = litRe.exec(block);
    }
    const hexRe = /<([0-9A-Fa-f\s]{2,})>\s*Tj/g;
    let hm: RegExpExecArray | null = hexRe.exec(block);
    while (hm) {
      const hex = hm[1].replace(/\s+/g, '');
      let decoded = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16);
        if (code >= 32 && code <= 126) decoded += String.fromCharCode(code);
      }
      if (decoded) parts.push(decoded);
      hm = hexRe.exec(block);
    }
    if (parts.length) chunks.push(parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  }
  return chunks.join('\n').trim();
}

function extractPdfText(bytes: Uint8Array): string {
  const latin = bytesToLatin1(bytes);
  const segments: string[] = [];
  const direct = extractPdfOperators(latin);
  if (direct) segments.push(direct);
  let cursor = 0;
  while (cursor < latin.length) {
    const sIdx = latin.indexOf('stream', cursor);
    if (sIdx < 0) break;
    const dictWindow = latin.slice(Math.max(0, sIdx - 256), sIdx);
    let dataStart = sIdx + 6;
    if (latin[dataStart] === '\r' && latin[dataStart + 1] === '\n') dataStart += 2;
    else if (latin[dataStart] === '\n' || latin[dataStart] === '\r') dataStart += 1;
    const eIdx = latin.indexOf('endstream', dataStart);
    if (eIdx < 0) break;
    let dataEnd = eIdx;
    while (dataEnd > dataStart && (bytes[dataEnd - 1] === 10 || bytes[dataEnd - 1] === 13)) dataEnd -= 1;
    if (/\/FlateDecode\b/.test(dictWindow) && !/\/Image\b/.test(dictWindow)) {
      const inflated = inflateZlibStream(bytes.subarray(dataStart, dataEnd));
      if (inflated) {
        const text = extractPdfOperators(bytesToLatin1(inflated));
        if (text) segments.push(text);
      }
    }
    cursor = eIdx + 9;
  }
  return segments.join('\n').trim();
}

/* ══ 5. Exact decimal-string to micro-currency parsing (zero floats) ═════ */

const MAX_SAFE_MICROS_BIG = BigInt(MAX_SAFE_MICROS);

/** Parse a clean decimal string (with optional US thousands or EU decimal comma) into exact integer micros. */
export function parsePriceStringToMicros(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, '');
  if (!s || s.startsWith('-')) return null;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (/^\d+,\d{1,6}$/.test(s)) {
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+,\d{1,6}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const micros = BigInt(m[1]) * 1_000_000n + BigInt((m[2] || '').padEnd(6, '0'));
  if (micros < 0n || micros > MAX_SAFE_MICROS_BIG) return null;
  return Number(micros);
}

const CURRENCY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  USD: 'USD', EUR: 'EUR', GBP: 'GBP', CNY: 'CNY', RMB: 'CNY', MXN: 'MXN', JPY: 'JPY', CAD: 'CAD',
});

function detectCurrencyCode(token: string, fullText: string): string | null {
  const upper = token.toUpperCase();
  if (CURRENCY_ALIASES[upper]) return CURRENCY_ALIASES[upper];
  if (token === '€') return 'EUR';
  if (token === '£') return 'GBP';
  if (token === '$') {
    if (/\bMXN\b/i.test(fullText)) return 'MXN';
    if (/\bCAD\b/i.test(fullText)) return 'CAD';
    return 'USD';
  }
  if (token === '¥') {
    return /\b(?:JPY|YEN)\b/i.test(fullText) && !/\b(?:CNY|RMB)\b/i.test(fullText) ? 'JPY' : 'CNY';
  }
  return null;
}

function parsePriceAndCurrency(snippet: string, fullText: string): { micros: number; currency: string | null } | null {
  const patterns: RegExp[] = [
    /(USD|EUR|GBP|CNY|RMB|MXN|JPY|CAD)\s*([$€£¥])?\s*(\d[\d.,]*)/i,
    /([$€£¥])\s*(\d[\d.,]*)\s*(USD|EUR|GBP|CNY|RMB|MXN|JPY|CAD)?/i,
    /(\d[\d.,]*)\s*(USD|EUR|GBP|CNY|RMB|MXN|JPY|CAD)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(snippet);
    if (!m) continue;
    const numStr = re === patterns[0] ? m[3] : re === patterns[1] ? m[2] : m[1];
    const curTok = re === patterns[0] ? (m[1] || m[2] || '') : re === patterns[1] ? (m[3] || m[1] || '') : m[2];
    const micros = parsePriceStringToMicros(numStr);
    if (micros !== null) return { micros, currency: detectCurrencyCode(curTok, fullText) };
  }
  const bare = /\b(\d[\d.,]*)\b/.exec(snippet);
  if (bare) {
    const micros = parsePriceStringToMicros(bare[1]);
    if (micros !== null) return { micros, currency: null };
  }
  return null;
}

/* ══ 6. CSV & Key-Value field extractors ═════════════════════════════════ */

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function extractCsvRow(text: string): Record<string, string> | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0].includes(',')) return null;
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const known = headers.some((h) => /vendor|supplier|unit_price|price|moq|lead_time|incoterm|currency|part|sku/.test(h));
  if (!known) return null;
  const values = parseCsvLine(lines[1]);
  const map: Record<string, string> = {};
  headers.forEach((h, i) => { if (h && values[i] !== undefined) map[h] = values[i]; });
  return map;
}

function cleanVendorValue(raw: string): string | null {
  const stripped = raw.replace(/<[^>]+>/g, '').replace(/^["']|["']$/g, '').trim();
  return stripped.length >= 2 ? stripped.slice(0, 160) : null;
}

function matchLabeledLine(lines: string[], labelRe: RegExp): string | null {
  for (const line of lines) {
    const m = labelRe.exec(line);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return null;
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const m = /(\d[\d,]*)/.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000 ? n : null;
}

function parseLeadTimeDays(raw: string | null): { days: number | null; note: string | null } {
  if (!raw) return { days: null, note: null };
  const weekRange = /(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:weeks?|wks?)\b/i.exec(raw);
  if (weekRange) {
    const high = Number(weekRange[2]);
    if (Number.isSafeInteger(high) && high > 0 && high <= 520) {
      return { days: high * 7, note: `Lead time converted from ${weekRange[1]}-${high} weeks to ${high * 7} days (upper bound)` };
    }
  }
  const weeks = /(\d+)\s*(?:weeks?|wks?)\b/i.exec(raw);
  if (weeks) {
    const n = Number(weeks[1]);
    if (Number.isSafeInteger(n) && n > 0 && n <= 520) {
      return { days: n * 7, note: `Lead time converted from ${n} week(s) to ${n * 7} days` };
    }
  }
  const days = /(\d+)\s*(?:business\s+|calendar\s+)?days?\b/i.exec(raw);
  if (days) {
    const n = Number(days[1]);
    if (Number.isSafeInteger(n) && n > 0 && n <= 3650) return { days: n, note: null };
  }
  const bare = /^(\d+)$/.exec(raw.trim());
  if (bare) {
    const n = Number(bare[1]);
    if (Number.isSafeInteger(n) && n > 0 && n <= 3650) return { days: n, note: null };
  }
  return { days: null, note: null };
}

function extractIncoterm(lines: string[], csv: Record<string, string> | null, fullText: string): string | null {
  const fromCsv = csv?.incoterm || csv?.incoterms || csv?.terms || null;
  const fromLabel = matchLabeledLine(lines, /^(?:incoterms?|shipping\s*terms?|trade\s*terms?|delivery\s*terms?)\s*[:\-]\s*(.+)$/i);
  const candidates = [fromCsv, fromLabel, fullText].filter(Boolean) as string[];
  for (const text of candidates) {
    for (const term of SUPPORTED_INCOTERMS) {
      if (new RegExp(`\\b${term}\\b`, 'i').test(text)) return term;
    }
  }
  return null;
}

function extractFieldsFromText(text: string): ExtractedQuoteFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const csv = extractCsvRow(text);
  const notes: string[] = [];

  const vendorRaw = csv?.vendor || csv?.supplier || csv?.vendor_name || csv?.supplier_name
    || matchLabeledLine(lines, /^(?:vendor|supplier|manufacturer|company|from)\s*[:\-]\s*(.+)$/i);
  const vendorName = vendorRaw ? cleanVendorValue(vendorRaw) : null;

  const itemRaw = csv?.item || csv?.part || csv?.part_name || csv?.description || csv?.sku
    || matchLabeledLine(lines, /^(?:item|part|part\s*name|sku|product|description|subject)\s*[:\-]\s*(.+)$/i);
  const itemLabel = itemRaw ? itemRaw.slice(0, 200) : null;

  const priceRaw = csv?.unit_price || csv?.unit_cost || csv?.price
    || matchLabeledLine(lines, /^(?:unit\s*price|unit\s*cost|price\s*\/\s*unit|fob\s*price|exw\s*price|price|rate)\s*[:\-]\s*(.+)$/i);
  let priceHit = priceRaw ? parsePriceAndCurrency(priceRaw, text) : null;
  if (!priceHit) {
    const nonTotalLines = lines.filter((l) => !/^(?:total|subtotal|tooling|shipping|freight)\b/i.test(l));
    for (const l of nonTotalLines) {
      const hit = parsePriceAndCurrency(l, text);
      if (hit && hit.currency) { priceHit = hit; break; }
    }
  }

  const explicitCurRaw = csv?.currency || matchLabeledLine(lines, /^currency\s*[:\-]\s*([A-Za-z]{3})\b/i);
  const explicitCur = explicitCurRaw ? detectCurrencyCode(explicitCurRaw.trim(), text) : null;
  const currency = priceHit?.currency || explicitCur || null;
  const unitPriceMicros = priceHit ? priceHit.micros : null;

  const moqRaw = csv?.moq || csv?.min_order_qty || csv?.qty_break || csv?.qty || csv?.quantity
    || matchLabeledLine(lines, /^(?:moq|min(?:imum)?\s*order(?:\s*qty|\s*quantity)?|qty\s*break|quantity|qty)\s*[:\-]\s*(.+)$/i);
  const moq = parsePositiveInt(moqRaw);

  const leadRaw = csv?.lead_time || csv?.lead_time_days || csv?.delivery
    || matchLabeledLine(lines, /^(?:lead\s*time|production\s*time|delivery(?:\s*time)?)\s*[:\-]\s*(.+)$/i);
  const lead = parseLeadTimeDays(leadRaw);
  if (lead.note) notes.push(lead.note);

  const incoterm = extractIncoterm(lines, csv, text);
  const quoteRefRaw = csv?.quote_ref || csv?.quote_number || csv?.rfq || csv?.ref
    || matchLabeledLine(lines, /^(?:quote\s*(?:#|no\.?|number|ref|id)|quotation\s*(?:#|no\.?)|rfq(?:\s*#|\s*ref)?|invoice\s*#|ref)\s*[:\-]\s*(.+)$/i);
  const quoteRef = quoteRefRaw ? quoteRefRaw.slice(0, 120) : null;

  return summarizeNotes({
    vendorName, itemLabel, unitPriceMicros, currency,
    moq, leadTimeDays: lead.days, incoterm, quoteRef, extractionNotes: notes,
  });
}

function summarizeNotes(f: ExtractedQuoteFields): ExtractedQuoteFields {
  const found: string[] = [];
  const missing: string[] = [];
  const check: Array<[string, unknown]> = [
    ['vendor', f.vendorName], ['unit price', f.unitPriceMicros], ['currency', f.currency],
    ['MOQ', f.moq], ['lead time', f.leadTimeDays], ['incoterm', f.incoterm], ['quote ref', f.quoteRef],
  ];
  for (const [label, val] of check) {
    if (val !== null && val !== undefined) found.push(label);
    else missing.push(label);
  }
  const notes = [...f.extractionNotes];
  if (found.length) notes.push(`Extracted: ${found.join(', ')}.`);
  if (missing.length) notes.push(`Needs review/entry: ${missing.join(', ')}.`);
  return { ...f, extractionNotes: notes };
}

/* ══ 7. Public entry point ═══════════════════════════════════════════════ */

function sanitizeFilename(raw: unknown): string {
  const base = String(raw ?? '').trim().replace(/[\r\n\0/\\]+/g, '_');
  if (!base) throw new QuoteInboxError('quote_filename_required', 'filename is required');
  return base.slice(0, 240);
}

function isPdfAttachment(filename: string, mimeType: string, bytes: Uint8Array): boolean {
  const hasHeader = bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50
    && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  return hasHeader || mimeType.toLowerCase().includes('pdf') || /\.pdf$/i.test(filename);
}

/**
 * @description Deterministically parse an uploaded or pasted supplier quote document.
 * @param input - Filename, optional MIME type, and either textContent or base64Bytes.
 * @returns SHA-256 digest, bounded excerpt, and candidate fields for operator review.
 */
export function parseQuoteDocument(input: QuoteDocumentInput): ParsedQuoteDocument {
  const filename = sanitizeFilename(input?.filename);
  const mimeType = String(input?.mimeType ?? 'text/plain').trim().slice(0, 120) || 'text/plain';
  const hasBase64 = typeof input?.base64Bytes === 'string' && input.base64Bytes.trim().length > 0;
  const hasText = typeof input?.textContent === 'string' && input.textContent.trim().length > 0;
  if (!hasBase64 && !hasText) {
    throw new QuoteInboxError('quote_document_empty', 'Provide a quote file or pasted quote text');
  }
  const bytes = hasBase64
    ? decodeBase64Bytes(String(input.base64Bytes), MAX_QUOTE_RAW_BYTES)
    : UTF8_ENC.encode(String(input.textContent));
  if (!hasBase64 && bytes.length > MAX_QUOTE_TEXT_BYTES) {
    throw new QuoteInboxError('quote_document_too_large', `textContent exceeds maximum size of ${MAX_QUOTE_TEXT_BYTES} bytes`);
  }
  const sha256 = sha256Hex(bytes);
  const isPdf = isPdfAttachment(filename, mimeType, bytes);
  const decodedText = hasText && !isPdf
    ? String(input.textContent)
    : (isPdf ? extractPdfText(bytes) : UTF8_DEC.decode(bytes));
  const cleanedText = decodedText.replace(/\0/g, '').trim();
  const alnumCount = (cleanedText.match(/[A-Za-z0-9]/g) || []).length;

  if (isPdf && alnumCount < 4) {
    return {
      filename, mimeType: mimeType === 'text/plain' ? 'application/pdf' : mimeType,
      byteSize: bytes.length, sha256, rawExcerpt: '',
      extracted: {
        vendorName: null, itemLabel: null, unitPriceMicros: null, currency: null,
        moq: null, leadTimeDays: null, incoterm: null, quoteRef: null,
        extractionNotes: [PDF_NO_TEXT_NOTE],
      },
    };
  }
  return {
    filename,
    mimeType: isPdf && mimeType === 'text/plain' ? 'application/pdf' : mimeType,
    byteSize: bytes.length,
    sha256,
    rawExcerpt: cleanedText.slice(0, MAX_EXCERPT_CHARS),
    extracted: extractFieldsFromText(cleanedText),
  };
}
