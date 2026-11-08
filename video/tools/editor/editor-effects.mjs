/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Shared per-clip speed (0.25x-4.0x with pitch preserved), named color looks, chroma key, foreground subject matting, stabilization and export resolution/frame-rate profiles for browser preview and FFmpeg compilation.
 */

export const SPEED_BOUNDS = Object.freeze({ min: 25, max: 400, default: 100 });
export const SPEED_PRESETS = Object.freeze([25, 50, 75, 100, 125, 150, 200, 300, 400]);

export const LOOK_CATALOG = Object.freeze([
  Object.freeze({ id: 'none', label: 'Original', swatch: '#64748b', sat: 1, con: 1, bri: 0, rs: 0, gs: 0, bs: 0, sepia: 0 }),
  Object.freeze({ id: 'warm', label: 'Warm', swatch: '#f59e0b', sat: 1.16, con: 1.04, bri: 0.03, rs: 0.14, gs: 0.04, bs: -0.14, sepia: 0.22 }),
  Object.freeze({ id: 'cool', label: 'Cool', swatch: '#38bdf8', sat: 1.08, con: 1.06, bri: 0, rs: -0.12, gs: 0.02, bs: 0.16, sepia: 0 }),
  Object.freeze({ id: 'vivid', label: 'Vivid', swatch: '#ec4899', sat: 1.48, con: 1.14, bri: 0.02, rs: 0.04, gs: 0, bs: 0.04, sepia: 0 }),
  Object.freeze({ id: 'noir', label: 'Noir', swatch: '#334155', sat: 0, con: 1.28, bri: -0.02, rs: 0, gs: 0, bs: 0, sepia: 0 }),
  Object.freeze({ id: 'vintage', label: 'Vintage', swatch: '#b45309', sat: 0.78, con: 0.94, bri: 0.04, rs: 0.16, gs: 0.08, bs: -0.12, sepia: 0.38 }),
  Object.freeze({ id: 'cinema', label: 'Cinema', swatch: '#0d9488', sat: 1.12, con: 1.18, bri: -0.02, rs: -0.06, gs: 0.03, bs: 0.10, sepia: 0 }),
]);
const LOOK_BY_ID = new Map(LOOK_CATALOG.map(entry => [entry.id, entry]));

export const STABILIZE_MODES = Object.freeze({
  off: Object.freeze({ id: 'off', label: 'Off', zoom: 1, rx: 0, ry: 0 }),
  light: Object.freeze({ id: 'light', label: 'Light', zoom: 1.04, rx: 16, ry: 16 }),
  standard: Object.freeze({ id: 'standard', label: 'Standard', zoom: 1.08, rx: 32, ry: 32 }),
  strong: Object.freeze({ id: 'strong', label: 'Strong', zoom: 1.14, rx: 48, ry: 48 }),
});

export const EXPORT_RESOLUTIONS = Object.freeze({
  '720p': Object.freeze({ id: '720p', label: '720p', width: 1280, height: 720, prefix: 'hd720p', mbPerMin30: 24 }),
  '1080p': Object.freeze({ id: '1080p', label: '1080p', width: 1920, height: 1080, prefix: 'hd1080p', mbPerMin30: 52 }),
  '4k': Object.freeze({ id: '4k', label: '4K', width: 3840, height: 2160, prefix: 'uhd4k', mbPerMin30: 165 }),
});
export const EXPORT_FPS_VALUES = Object.freeze([30, 60]);

function isPlain(v) { return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function isInt(v, min, max) { return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max; }

/** @description Effective timeline duration in 30fps frames for a source [inFrame, outFrame) range at integer percent speed. */
export function clipDurationFrames(inFrame, outFrame, speed = 100) {
  const raw = outFrame - inFrame;
  if (raw <= 0) return 0;
  return speed === 100 ? raw : Math.max(1, Math.round((raw * 100) / speed));
}

/** @description Human-readable playback rate badge (e.g. 0.5×, 1×, 2×). */
export function formatSpeed(speed = 100) {
  const ratio = speed / 100;
  return `${Number.isInteger(ratio) ? ratio : Number(ratio.toFixed(2))}×`;
}

/** @description Decompose percent speed (25..400) into FFmpeg pitch-preserving atempo stages within [0.5, 2.0]. */
export function atempoChain(speed = 100) {
  if (speed === 100) return [];
  let remaining = speed / 100;
  const stages = [];
  while (remaining < 0.5 - 1e-9) { stages.push('0.500000'); remaining /= 0.5; }
  while (remaining > 2.0 + 1e-9) { stages.push('2.000000'); remaining /= 2.0; }
  if (Math.abs(remaining - 1) > 1e-6) stages.push(Math.min(2, Math.max(0.5, remaining)).toFixed(6));
  return stages;
}

/** @description Validate optional clip speed (integer percent 25..400). */
export function validateSpeed(value) {
  if (value === undefined) return 100;
  if (!isInt(value, SPEED_BOUNDS.min, SPEED_BOUNDS.max)) throw new TypeError('Invalid clip speed');
  return value;
}

/** @description Validate optional named color look ({ id, strength }). */
export function validateLook(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlain(value)) throw new TypeError('Invalid clip look');
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('strength')) throw new TypeError('Invalid clip look fields');
  if (typeof value.id !== 'string' || !LOOK_BY_ID.has(value.id) || !isInt(value.strength, 0, 100)) throw new TypeError('Invalid clip look values');
  return value.id === 'none' || value.strength === 0 ? undefined : { id: value.id, strength: value.strength };
}

/** @description Validate optional stabilization strength ('off' | 'light' | 'standard' | 'strong'). */
export function validateStabilize(value) {
  if (value === undefined || value === 'off') return undefined;
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(STABILIZE_MODES, value)) throw new TypeError('Invalid stabilize mode');
  return value;
}

/** @description Validate optional chroma key settings ({ enabled, color, similarity, blend }). */
export function validateChromaKey(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlain(value)) throw new TypeError('Invalid chroma key');
  const keys = Object.keys(value);
  if (keys.some(k => !['enabled', 'color', 'similarity', 'blend'].includes(k)) || keys.length !== 4) throw new TypeError('Invalid chroma key fields');
  if (typeof value.enabled !== 'boolean' || typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color)
    || !isInt(value.similarity, 1, 100) || !isInt(value.blend, 0, 100)) throw new TypeError('Invalid chroma key values');
  return value.enabled ? { enabled: true, color: value.color.toLowerCase(), similarity: value.similarity, blend: value.blend } : undefined;
}

/** @description Validate optional foreground background-removal settings ({ enabled, strength }). */
export function validateRemoveBg(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlain(value)) throw new TypeError('Invalid remove background');
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('enabled') || !keys.includes('strength')) throw new TypeError('Invalid remove background fields');
  if (typeof value.enabled !== 'boolean' || !isInt(value.strength, 1, 100)) throw new TypeError('Invalid remove background values');
  return value.enabled ? { enabled: true, strength: value.strength } : undefined;
}

/** @description CSS filter string for live preview combining named look and optional v2 brightness/contrast/saturation. */
export function cssFilterForClip(clip) {
  const parts = [];
  const c = clip?.color;
  if (c) {
    if (c.brightness) parts.push(`brightness(${(1 + c.brightness / 100).toFixed(3)})`);
    if (c.contrast && c.contrast !== 100) parts.push(`contrast(${(c.contrast / 100).toFixed(3)})`);
    if (c.saturation !== undefined && c.saturation !== 100) parts.push(`saturate(${(c.saturation / 100).toFixed(3)})`);
  }
  const look = clip?.look && LOOK_BY_ID.get(clip.look.id);
  if (look && look.id !== 'none' && clip.look.strength > 0) {
    const t = clip.look.strength / 100;
    const bri = 1 + look.bri * t, con = 1 + (look.con - 1) * t, sat = 1 + (look.sat - 1) * t, sep = look.sepia * t;
    parts.push(`brightness(${bri.toFixed(3)})`, `contrast(${con.toFixed(3)})`, `saturate(${sat.toFixed(3)})`);
    if (sep > 0.005) parts.push(`sepia(${sep.toFixed(3)})`);
    if (look.id === 'cool') parts.push(`hue-rotate(${(-12 * t).toFixed(1)}deg)`);
    if (look.id === 'cinema') parts.push(`hue-rotate(${(-6 * t).toFixed(1)}deg)`);
  }
  return parts.length ? parts.join(' ') : 'none';
}

/** @description FFmpeg video filter expressions for a named look at its strength. */
export function ffmpegLookFilters(look) {
  const spec = look && LOOK_BY_ID.get(look.id);
  if (!spec || spec.id === 'none' || !(look.strength > 0)) return [];
  const t = Math.min(100, Math.max(0, look.strength)) / 100;
  const bri = (spec.bri * t).toFixed(3), con = (1 + (spec.con - 1) * t).toFixed(3), sat = (1 + (spec.sat - 1) * t).toFixed(3);
  const filters = [`eq=brightness=${bri}:contrast=${con}:saturation=${sat}`];
  const rs = (spec.rs * t).toFixed(3), gs = (spec.gs * t).toFixed(3), bs = (spec.bs * t).toFixed(3);
  if (Math.abs(spec.rs * t) > 0.005 || Math.abs(spec.gs * t) > 0.005 || Math.abs(spec.bs * t) > 0.005) {
    filters.push(`colorbalance=rs=${rs}:gs=${gs}:bs=${bs}:rm=${rs}:gm=${gs}:bm=${bs}`);
  }
  return filters;
}

/** @description FFmpeg stabilization filter stage for a clip. */
export function ffmpegStabilizeFilters(mode, width, height) {
  const spec = mode && STABILIZE_MODES[mode];
  if (!spec || spec.id === 'off') return [];
  const sw = Math.round((width * spec.zoom) / 2) * 2, sh = Math.round((height * spec.zoom) / 2) * 2;
  return [`deshake=rx=${spec.rx}:ry=${spec.ry}:edge=mirror`, `scale=${sw}:${sh}`, `crop=${width}:${height}`];
}

/** @description FFmpeg chroma-key filter stage producing RGBA alpha. */
export function ffmpegChromaKeyFilters(ck) {
  if (!ck?.enabled || !/^#[0-9a-f]{6}$/i.test(ck.color)) return [];
  const hex = `0x${ck.color.slice(1).toUpperCase()}`;
  const sim = Math.max(0.01, Math.min(1, ck.similarity / 100)).toFixed(3);
  const blend = Math.max(0, Math.min(1, ck.blend / 100)).toFixed(3);
  return ['format=rgba', `colorkey=${hex}:${sim}:${blend}`];
}

/** @description FFmpeg adaptive border-referenced foreground matting filter producing RGBA alpha without altering source media. */
export function ffmpegRemoveBgFilters(removeBg) {
  if (!removeBg?.enabled) return [];
  const threshold = Math.round(18 + ((100 - Math.min(100, Math.max(1, removeBg.strength))) * 0.9));
  const diff = `abs(r(X,Y)-(r(2,2)+r(W-3,2))/2)+abs(g(X,Y)-(g(2,2)+g(W-3,2))/2)+abs(b(X,Y)-(b(2,2)+b(W-3,2))/2)`;
  return ['format=rgba', `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip((${diff}-${threshold})*6,0,255)'`];
}

/** @description Resolve export resolution + fps options into validated profile dimensions and estimated output metrics. */
export function resolveExportSpec({ variant = 'export', resolution = '720p', fps = 30, timelineFrames30 = 30 } = {}) {
  if (variant !== 'export' && variant !== 'preview') throw new Error('invalid_video_edit_export_variant');
  if (variant === 'preview') {
    const outFrames = Math.max(1, timelineFrames30);
    return { variant: 'preview', profile: 'hd720p30', resolution: '360p', width: 640, height: 360, fps: 30, fpsScale: 1,
      totalFrames: outFrames, estimatedBytes: Math.max(65536, Math.round((outFrames / 30) * 140000)), estimatedSeconds: Math.max(1, Math.ceil(outFrames / 90)) };
  }
  const res = EXPORT_RESOLUTIONS[resolution];
  if (!res) throw new Error('invalid_video_edit_export_resolution');
  if (!EXPORT_FPS_VALUES.includes(fps)) throw new Error('invalid_video_edit_export_fps');
  const fpsScale = fps === 60 ? 2 : 1;
  const totalFrames = Math.max(1, timelineFrames30 * fpsScale);
  const seconds = timelineFrames30 / 30;
  const fpsFactor = fps === 60 ? 1.65 : 1;
  const estimatedBytes = Math.max(131072, Math.round((seconds / 60) * res.mbPerMin30 * 1048576 * fpsFactor));
  const pixelFactor = (res.width * res.height) / (1280 * 720);
  const estimatedSeconds = Math.max(1, Math.ceil(seconds * 0.45 * pixelFactor * (fps === 60 ? 1.8 : 1)));
  return { variant: 'export', profile: `${res.prefix}${fps}`, resolution: res.id, width: res.width, height: res.height,
    fps, fpsScale, totalFrames, estimatedBytes, estimatedSeconds };
}

/** @description Apply chroma-key and/or border-sampled foreground matting in-place on an ImageData buffer for live preview. */
export function applyPreviewMatte(imageData, chromaKey, removeBg) {
  const d = imageData.data, w = imageData.width, h = imageData.height;
  let kr = 0, kg = 255, kb = 0, ckThresh = 0, ckSoft = 1;
  if (chromaKey?.enabled) {
    kr = parseInt(chromaKey.color.slice(1, 3), 16); kg = parseInt(chromaKey.color.slice(3, 5), 16); kb = parseInt(chromaKey.color.slice(5, 7), 16);
    ckThresh = (chromaKey.similarity / 100) * 260; ckSoft = Math.max(8, (chromaKey.blend / 100) * 180);
  }
  let br = 0, bg = 0, bb = 0, bgThresh = 0;
  if (removeBg?.enabled && w >= 4 && h >= 4) {
    let count = 0;
    const sample = (x, y) => { const idx = (y * w + x) * 4; br += d[idx]; bg += d[idx + 1]; bb += d[idx + 2]; count += 1; };
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 16))) { sample(x, 1); sample(x, Math.min(h - 1, 3)); }
    for (let y = 0; y < Math.floor(h * 0.6); y += Math.max(1, Math.floor(h / 12))) { sample(1, y); sample(w - 2, y); }
    br /= count || 1; bg /= count || 1; bb /= count || 1;
    bgThresh = 18 + (100 - removeBg.strength) * 0.9;
  }
  for (let i = 0; i < d.length; i += 4) {
    let alpha = 255;
    if (chromaKey?.enabled) {
      const dist = Math.hypot(d[i] - kr, d[i + 1] - kg, d[i + 2] - kb);
      alpha = Math.min(alpha, dist <= ckThresh ? 0 : Math.min(255, Math.round(((dist - ckThresh) / ckSoft) * 255)));
    }
    if (removeBg?.enabled) {
      const manhattan = Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
      alpha = Math.min(alpha, Math.max(0, Math.min(255, Math.round((manhattan - bgThresh) * 6))));
    }
    d[i + 3] = alpha;
  }
}
