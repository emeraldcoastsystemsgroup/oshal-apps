/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Licensed built-in sticker catalog, keyframed sticker overlay validation, DOM SVG data-URI preview and analytical RGBA rasterizer for FFmpeg overlay export.
 */

export const STICKER_LIMIT = 16;

export const STICKER_CATALOG = Object.freeze([
  Object.freeze({ id: 'star', label: 'Gold Star', glyph: '★', fill: '#facc15', stroke: '#ca8a04', accent: '#fef08a', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'heart', label: 'Ruby Heart', glyph: '♥', fill: '#f43f5e', stroke: '#be123c', accent: '#fda4af', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'sparkle', label: 'Sparkle', glyph: '✦', fill: '#38bdf8', stroke: '#0284c7', accent: '#e0f2fe', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'fire', label: 'Flame', glyph: '🔥', fill: '#fb923c', stroke: '#ea580c', accent: '#fde047', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'check', label: 'Verified', glyph: '✓', fill: '#22c55e', stroke: '#15803d', accent: '#ffffff', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'arrow', label: 'Pointer', glyph: '➜', fill: '#a855f7', stroke: '#7e22ce', accent: '#f3e8ff', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'speech', label: 'Pop Bubble', glyph: '💬', fill: '#f8fafc', stroke: '#334155', accent: '#0ea5e9', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
  Object.freeze({ id: 'clap', label: 'Applause', glyph: '👏', fill: '#f472b6', stroke: '#db2777', accent: '#fce7f3', license: 'CC0-1.0', attribution: 'OSHAL Original Sticker' }),
]);
export const STICKER_BY_ID = new Map(STICKER_CATALOG.map(item => [item.id, item]));

function isPlain(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function isInt(v, min, max) { return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max; }
function hexRgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }

/** @description Build a crisp self-contained SVG string for a built-in sticker. */
export function stickerSvg(stickerId) {
  const s = STICKER_BY_ID.get(stickerId) ?? STICKER_CATALOG[0];
  const shapes = {
    star: `<polygon points="64,8 80,44 120,48 90,74 99,114 64,93 29,114 38,74 8,48 48,44" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6" stroke-linejoin="round"/>`,
    heart: `<path d="M64 112 C20 82 10 52 24 30 C36 12 56 18 64 34 C72 18 92 12 104 30 C118 52 108 82 64 112 Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/>`,
    sparkle: `<path d="M64 6 L76 52 L122 64 L76 76 L64 122 L52 76 L6 64 L52 52 Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="5"/>`,
    fire: `<path d="M64 10 C92 38 108 62 98 92 C90 112 72 120 64 120 C44 120 26 102 30 76 C34 54 50 42 64 10 Z" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/><circle cx="64" cy="88" r="18" fill="${s.accent}"/>`,
    check: `<circle cx="64" cy="64" r="52" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/><polyline points="38,66 56,84 92,46" fill="none" stroke="${s.accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`,
    arrow: `<circle cx="64" cy="64" r="52" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/><path d="M34 64 H88 M68 42 L92 64 L68 86" fill="none" stroke="${s.accent}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
    speech: `<rect x="14" y="18" width="100" height="72" rx="22" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/><polygon points="38,88 28,116 62,90" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/><circle cx="44" cy="54" r="7" fill="${s.accent}"/><circle cx="64" cy="54" r="7" fill="${s.accent}"/><circle cx="84" cy="54" r="7" fill="${s.accent}"/>`,
    clap: `<circle cx="64" cy="64" r="52" fill="${s.fill}" stroke="${s.stroke}" stroke-width="6"/><polygon points="64,22 74,48 102,48 80,64 88,92 64,76 40,92 48,64 26,48 54,48" fill="${s.accent}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${shapes[s.id] ?? shapes.star}</svg>`;
}

/** @description Data URI for displaying a sticker inside preview overlays or thumbnails. */
export function stickerDataUri(stickerId) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(stickerSvg(stickerId))}`;
}

function validateStickerKeys(keys, duration) {
  if (keys === undefined) return undefined;
  if (!Array.isArray(keys) || keys.length > 8) throw new TypeError('Invalid sticker keyframes');
  let prev = -1;
  return keys.map(k => {
    if (!isPlain(k) || Object.keys(k).some(f => !['frame', 'x', 'y', 'scale'].includes(f))) throw new TypeError('Invalid sticker keyframe');
    if (!isInt(k.frame, 0, duration) || k.frame <= prev || !isInt(k.x, 0, 100) || !isInt(k.y, 0, 100) || !isInt(k.scale, 25, 300)) {
      throw new TypeError('Invalid sticker keyframe bounds');
    }
    prev = k.frame;
    return { frame: k.frame, x: k.x, y: k.y, scale: k.scale };
  });
}

/** @description Validate optional stickers array on v1 or v2 timeline documents. */
export function validateStickers(value, totalFrames) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > STICKER_LIMIT) throw new TypeError('Invalid stickers list');
  if (value.length > 0 && totalFrames <= 0) throw new TypeError('Add a clip before placing stickers');
  const ids = new Set();
  return value.map(item => {
    if (!isPlain(item)) throw new TypeError('Invalid sticker item');
    if (Object.keys(item).some(k => !['id', 'stickerId', 'start', 'end', 'x', 'y', 'scale', 'keys'].includes(k))) throw new TypeError('Invalid sticker fields');
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id)) throw new TypeError('Invalid sticker id');
    if (typeof item.stickerId !== 'string' || !STICKER_BY_ID.has(item.stickerId)) throw new TypeError('Unknown sticker');
    if (!isInt(item.start, 0, totalFrames - 1) || !isInt(item.end, item.start + 1, totalFrames)) throw new TypeError('Invalid sticker timing');
    if (!isInt(item.x, 0, 100) || !isInt(item.y, 0, 100) || !isInt(item.scale, 25, 300)) throw new TypeError('Invalid sticker placement');
    ids.add(item.id);
    const keys = validateStickerKeys(item.keys, item.end - item.start);
    return { id: item.id, stickerId: item.stickerId, start: item.start, end: item.end, x: item.x, y: item.y, scale: item.scale, ...(keys?.length ? { keys } : {}) };
  });
}

/** @description Interpolate a sticker's { x, y, scale } at timeline frame `frame`. */
export function stickerPoseAt(sticker, frame) {
  const local = Math.max(0, Math.min(sticker.end - sticker.start, frame - sticker.start));
  const keys = sticker.keys;
  if (!keys?.length) return { x: sticker.x, y: sticker.y, scale: sticker.scale };
  if (local <= keys[0].frame) return { x: keys[0].x, y: keys[0].y, scale: keys[0].scale };
  const last = keys[keys.length - 1];
  if (local >= last.frame) return { x: last.x, y: last.y, scale: last.scale };
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i], b = keys[i + 1];
    if (local >= a.frame && local <= b.frame) {
      const t = (local - a.frame) / Math.max(1, b.frame - a.frame);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: a.scale + (b.scale - a.scale) * t };
    }
  }
  return { x: sticker.x, y: sticker.y, scale: sticker.scale };
}

function insideShape(id, nx, ny) {
  const r = Math.hypot(nx, ny), ang = Math.atan2(ny, nx);
  if (id === 'star' || id === 'clap') return r <= 0.56 + 0.28 * Math.cos(5 * (ang + Math.PI / 2));
  if (id === 'sparkle') return Math.pow(Math.abs(nx), 0.65) + Math.pow(Math.abs(ny), 0.65) <= 0.86;
  if (id === 'heart') { const x = nx * 1.25, y = -ny * 1.25 + 0.15; return Math.pow(x * x + y * y - 0.55, 3) - x * x * y * y * y <= 0; }
  if (id === 'fire') return Math.hypot(nx * (1 + 0.35 * (-ny)), ny - 0.08) <= 0.78 && !(ny < -0.75);
  if (id === 'speech') return (Math.abs(nx) <= 0.82 && ny >= -0.72 && ny <= 0.45 && Math.hypot(Math.max(0, Math.abs(nx) - 0.58), Math.max(0, Math.abs(ny + 0.13) - 0.35)) <= 0.24)
    || (nx >= -0.55 && nx <= -0.05 && ny >= 0.35 && ny <= 0.85 && (nx + 0.55) * 0.9 >= (ny - 0.35) * 0.5);
  return r <= 0.86;
}

function insideAccent(id, nx, ny) {
  if (id === 'check') {
    const d1 = Math.abs((nx + 0.22) - (ny - 0.08)) / Math.SQRT2, in1 = nx >= -0.45 && nx <= -0.08 && ny >= -0.05 && ny <= 0.34 && d1 <= 0.11;
    const d2 = Math.abs((nx + 0.08) + (ny - 0.28)) / Math.SQRT2, in2 = nx >= -0.12 && nx <= 0.48 && ny >= -0.32 && ny <= 0.34 && d2 <= 0.11;
    return in1 || in2;
  }
  if (id === 'arrow') {
    const shaft = Math.abs(ny) <= 0.10 && nx >= -0.46 && nx <= 0.36;
    const head = nx >= 0.02 && nx <= 0.48 && Math.abs(Math.abs(ny) - (0.46 - nx)) <= 0.12;
    return shaft || head;
  }
  if (id === 'fire') return Math.hypot(nx, ny - 0.32) <= 0.28;
  if (id === 'speech') return [-0.34, 0, 0.34].some(cx => Math.hypot(nx - cx, ny + 0.12) <= 0.11);
  if (id === 'clap') return Math.hypot(nx, ny) <= 0.36 + 0.18 * Math.cos(5 * (Math.atan2(ny, nx) + Math.PI / 2));
  return Math.hypot(nx + 0.2, ny + 0.2) <= 0.14;
}

/** @description Rasterize a sticker into a square RGBA Uint8Array of `size * size * 4` bytes for PNG export. */
export function rasterizeStickerRgba(stickerId, size) {
  const s = STICKER_BY_ID.get(stickerId) ?? STICKER_CATALOG[0];
  const fill = hexRgb(s.fill), stroke = hexRgb(s.stroke), accent = hexRgb(s.accent);
  const side = Math.max(16, Math.min(768, Math.round(size)));
  const out = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    const ny = ((y + 0.5) / side) * 2 - 1;
    for (let x = 0; x < side; x += 1) {
      const nx = ((x + 0.5) / side) * 2 - 1;
      const idx = (y * side + x) * 4;
      if (!insideShape(s.id, nx, ny)) continue;
      const border = !insideShape(s.id, nx * 1.12, ny * 1.12);
      const color = border ? stroke : (insideAccent(s.id, nx, ny) ? accent : fill);
      out[idx] = color[0]; out[idx + 1] = color[1]; out[idx + 2] = color[2]; out[idx + 3] = 255;
    }
  }
  return { width: side, height: side, data: out };
}
