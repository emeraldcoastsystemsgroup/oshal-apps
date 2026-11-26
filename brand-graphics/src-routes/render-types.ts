/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: typed validation and normalization for Brand Graphics renders (CREATE-TOOL-BRAND-04, -05, -06, -07).
 */
export type BrandMode = 'intro' | 'graphic';
export type MusicChoice = 'none' | 'clean-pulse' | 'warm-ambient' | 'broadcast-sting';
export type BrandStyle = 'my-brand' | 'oshal';
export type AspectRatio = '16:9' | '9:16' | '1:1';
export type OutputFormat = 'mp4';

export interface ResolvedBrandKit {
  brandStyle: BrandStyle;
  brandName: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  logoRef: string | null;
  source: 'open-swarm-default' | 'request' | 'create-brand-kit' | 'saved-brand-kit' | 'fallback';
}

export interface RenderInput {
  brief: string;
  title: string;
  sourceLink: string;
  brandMode: BrandMode;
  voiceover: string;
  music: MusicChoice;
  brandStyle: BrandStyle;
  brandKit: Partial<ResolvedBrandKit> | null;
  durationSec: number;
  aspect: AspectRatio;
  format: OutputFormat;
}

export interface RenderJobRecord {
  id: string;
  status: 'done' | 'failed';
  title: string;
  brief: string;
  sourceLink: string;
  brandMode: BrandMode;
  voiceover: string;
  music: MusicChoice;
  brandStyle: BrandStyle;
  brandKit: ResolvedBrandKit;
  durationSec: number;
  aspect: AspectRatio;
  width: number;
  height: number;
  format: OutputFormat;
  fileName: string;
  fileBytes: number;
  previewUrl: string;
  downloadUrl: string;
  renderer: 'local-ffmpeg' | 'worker';
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export class RenderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 720, height: 720 },
};

export const MUSIC_CHOICES: readonly MusicChoice[] = ['none', 'clean-pulse', 'warm-ambient', 'broadcast-sting'];
export const ASPECT_CHOICES: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];
export const FORMAT_CHOICES: readonly OutputFormat[] = ['mp4'];

export const OPEN_SWARM_KIT: ResolvedBrandKit = Object.freeze({
  brandStyle: 'oshal',
  brandName: 'Open Swarm',
  primaryColor: '#00a3ff',
  accentColor: '#38bdf8',
  backgroundColor: '#081226',
  logoRef: null,
  source: 'open-swarm-default',
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ALLOWED_BODY_KEYS = new Set([
  'brief', 'subject', 'title', 'sourceLink', 'sourceUrl', 'brandMode', 'mode',
  'voiceover', 'music', 'brandStyle', 'brandKit', 'durationSec', 'aspect', 'format',
]);
const ALLOWED_KIT_KEYS = new Set([
  'brandName', 'name', 'primaryColor', 'accentColor', 'backgroundColor', 'logoRef', 'colors', 'logo',
]);

function cleanLine(value: unknown, maxLen: number, field: string, allowEmpty = true): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maxLen || CONTROL_CHARS.test(value)) {
    throw new RenderError(400, `invalid_${field}`, `${field} must be text up to ${maxLen} characters.`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new RenderError(400, `${field}_required`, `${field} is required.`);
  return trimmed;
}

function cleanLink(value: unknown): string {
  const raw = cleanLine(value, 2000, 'sourceLink', true);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw new RenderError(400, 'invalid_source_link', 'sourceLink must be an http:// or https:// URL.');
  }
}

export function cleanHex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
    throw new RenderError(400, `invalid_${field}`, `${field} must be a 6-digit hex color like #1d4ed8.`);
  }
  return value.trim().toLowerCase();
}

function cleanMusic(value: unknown, brandMode: BrandMode): MusicChoice {
  if (value === undefined || value === null || value === '') {
    return brandMode === 'intro' ? 'broadcast-sting' : 'none';
  }
  if (typeof value === 'boolean') return value ? 'broadcast-sting' : 'none';
  if (typeof value === 'string' && MUSIC_CHOICES.includes(value as MusicChoice)) {
    return value as MusicChoice;
  }
  throw new RenderError(400, 'invalid_music', `music must be one of: ${MUSIC_CHOICES.join(', ')}.`);
}

function cleanBrandStyle(value: unknown): BrandStyle {
  if (value === undefined || value === null || value === '') return 'my-brand';
  if (value === 'my-brand' || value === 'oshal') return value;
  if (value === 'open-swarm') return 'oshal';
  throw new RenderError(400, 'invalid_brand_style', 'brandStyle must be my-brand or oshal.');
}

function cleanDuration(value: unknown): number {
  if (value === undefined || value === null || value === '') return 10;
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < 5 || num > 60) {
    throw new RenderError(400, 'invalid_duration', 'durationSec must be an integer between 5 and 60 seconds.');
  }
  return num;
}

function cleanAspect(value: unknown): AspectRatio {
  if (value === undefined || value === null || value === '') return '16:9';
  if (typeof value === 'string' && ASPECT_CHOICES.includes(value as AspectRatio)) {
    return value as AspectRatio;
  }
  throw new RenderError(400, 'invalid_aspect', 'aspect must be 16:9, 9:16, or 1:1.');
}

function cleanFormat(value: unknown): OutputFormat {
  if (value === undefined || value === null || value === '') return 'mp4';
  if (value === 'mp4') return 'mp4';
  throw new RenderError(400, 'invalid_format', 'format must be mp4.');
}

function cleanLogoRef(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && value !== null && typeof (value as any).src === 'string') {
    return cleanLogoRef((value as any).src);
  }
  if (typeof value !== 'string' || value.length > 500 || CONTROL_CHARS.test(value)) {
    throw new RenderError(400, 'invalid_logo_ref', 'logoRef must be a bounded string.');
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('/api/') && !/^https?:\/\//.test(trimmed) && !/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new RenderError(400, 'invalid_logo_ref', 'logoRef must be an asset route, URL, or identifier.');
  }
  return trimmed;
}

export function parseBrandKitPatch(raw: unknown): Partial<ResolvedBrandKit> | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new RenderError(400, 'invalid_brand_kit', 'brandKit must be an object.');
  }
  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_KIT_KEYS.has(key)) throw new RenderError(400, 'invalid_brand_kit', `Unsupported brandKit field: ${key}`);
  }
  const colors = (rec.colors && typeof rec.colors === 'object' && !Array.isArray(rec.colors))
    ? (rec.colors as Record<string, unknown>) : null;
  const out: Partial<ResolvedBrandKit> = {};
  const nameVal = rec.brandName ?? rec.name;
  if (nameVal !== undefined) out.brandName = cleanLine(nameVal, 80, 'brandName', true);
  const primary = rec.primaryColor ?? colors?.primary;
  if (primary !== undefined) out.primaryColor = cleanHex(primary, 'primaryColor');
  const accent = rec.accentColor ?? colors?.accent ?? colors?.secondary;
  if (accent !== undefined) out.accentColor = cleanHex(accent, 'accentColor');
  const bg = rec.backgroundColor ?? colors?.dark ?? colors?.light;
  if (bg !== undefined) out.backgroundColor = cleanHex(bg, 'backgroundColor');
  if (rec.logoRef !== undefined || rec.logo !== undefined) out.logoRef = cleanLogoRef(rec.logoRef ?? rec.logo);
  return out;
}

export function validateRenderInput(body: unknown): RenderInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RenderError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  const rec = body as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_BODY_KEYS.has(key)) throw new RenderError(400, 'unsupported_field', `Unsupported field: ${key}`);
  }
  const brief = cleanLine(rec.brief ?? rec.subject, 2000, 'brief', false);
  const rawMode = rec.brandMode ?? rec.mode ?? 'intro';
  if (rawMode !== 'intro' && rawMode !== 'graphic') {
    throw new RenderError(400, 'invalid_brand_mode', 'brandMode must be intro or graphic.');
  }
  const title = cleanLine(rec.title, 120, 'title', true) || brief.slice(0, 80);
  return {
    brief,
    title,
    sourceLink: cleanLink(rec.sourceLink ?? rec.sourceUrl),
    brandMode: rawMode,
    voiceover: cleanLine(rec.voiceover, 1000, 'voiceover', true),
    music: cleanMusic(rec.music, rawMode),
    brandStyle: cleanBrandStyle(rec.brandStyle),
    brandKit: parseBrandKitPatch(rec.brandKit),
    durationSec: cleanDuration(rec.durationSec),
    aspect: cleanAspect(rec.aspect),
    format: cleanFormat(rec.format),
  };
}
