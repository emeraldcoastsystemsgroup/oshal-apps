/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: deterministic audio extraction, RGB colour-space scene detection (160x90 int16 MAD), and camera-strip privacy cropping for Meeting Recap.
 */
import { execFile as execFileCb, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export const ALLOWED_MEDIA_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.wav', '.mp3', '.m4a']);
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
export const CROP_MODES = new Set(['right-strip', 'top-strip', 'bottom-strip', 'custom', 'none']);
export const SCENE_WIDTH = 160;
export const SCENE_HEIGHT = 90;
export const FRAME_BYTES = SCENE_WIDTH * SCENE_HEIGHT * 3;
export const DEFAULT_SCENE_THRESHOLD = 6.0;
export const MAX_KEYFRAMES = 240;

/** Resolve system ffmpeg/ffprobe path safely without shell lookup. */
export function resolveBinary(name) {
  const sys = `/usr/bin/${name}`;
  return existsSync(sys) ? sys : name;
}

/** Extract lowercased extension if filename is safe and permitted. */
export function safeMediaExt(filename) {
  const base = path.basename(String(filename || '').trim());
  if (!base || base.includes('\0')) return null;
  const ext = path.extname(base).toLowerCase();
  return ALLOWED_MEDIA_EXTS.has(ext) ? ext : null;
}

/** Whether a filename has an admitted audio or video media extension. */
export function isAllowedMediaFilename(filename) {
  return safeMediaExt(filename) !== null;
}

/** Format non-negative seconds as MM:SS or HH:MM:SS. */
export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${String(hrs).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Validate and normalize crop mode (defaulting to privacy-safe right-strip). */
export function normalizeCropMode(rawMode, rawRect = null) {
  const mode = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : 'right-strip';
  if (!CROP_MODES.has(mode)) return { mode: 'right-strip', rect: null };
  if (mode !== 'custom') return { mode, rect: null };
  const r = rawRect && typeof rawRect === 'object' ? rawRect : {};
  const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
  const valid = [x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0.05 && h > 0.05 && x + w <= 1.0001 && y + h <= 1.0001;
  if (!valid) return { mode: 'right-strip', rect: null };
  return { mode: 'custom', rect: { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) } };
}

/** Build ffmpeg crop filter expression removing participant camera tiles. */
export function computeCropFilter(cropMode, customRect = null) {
  const norm = typeof cropMode === 'object' && cropMode !== null ? cropMode : normalizeCropMode(cropMode, customRect);
  if (norm.mode === 'none') return null;
  if (norm.mode === 'right-strip') return 'crop=floor(iw*0.78/2)*2:ih:0:0';
  if (norm.mode === 'top-strip') return 'crop=iw:floor(ih*0.80/2)*2:0:floor(ih*0.20/2)*2';
  if (norm.mode === 'bottom-strip') return 'crop=iw:floor(ih*0.80/2)*2:0:0';
  if (norm.mode === 'custom' && norm.rect) {
    const { x, y, w, h } = norm.rect;
    return `crop=max(2\\,floor(iw*${w.toFixed(4)}/2)*2):max(2\\,floor(ih*${h.toFixed(4)}/2)*2):floor(iw*${x.toFixed(4)}):floor(ih*${y.toFixed(4)})`;
  }
  return 'crop=floor(iw*0.78/2)*2:ih:0:0';
}

/**
 * Pure RGB colour-space Mean Absolute Difference across equal-length rgb24 buffers.
 * Uses signed integer channel differences (`|r1-r2| + |g1-g2| + |b1-b2|`, divided by length)
 * so isoluminant colour-only slide changes are caught rather than missed by greyscale.
 */
export function meanAbsDiffRgb(frameA, frameB) {
  if (!(frameA instanceof Uint8Array) || !(frameB instanceof Uint8Array)) {
    throw new TypeError('meanAbsDiffRgb requires Uint8Array inputs');
  }
  if (frameA.length === 0 || frameA.length !== frameB.length) {
    throw new RangeError('meanAbsDiffRgb requires equal non-empty frame buffers');
  }
  let sum = 0;
  for (let i = 0; i < frameA.length; i += 1) {
    const diff = (frameA[i] | 0) - (frameB[i] | 0);
    sum += diff < 0 ? -diff : diff;
  }
  return sum / frameA.length;
}

/** Diagnostic BT.601 greyscale MAD helper (never used for scene detection). */
export function meanAbsDiffLuma(frameA, frameB) {
  if (!(frameA instanceof Uint8Array) || !(frameB instanceof Uint8Array) || frameA.length !== frameB.length || frameA.length % 3 !== 0) {
    throw new RangeError('meanAbsDiffLuma requires equal rgb24 Uint8Array buffers');
  }
  const pixels = frameA.length / 3;
  let sum = 0;
  for (let i = 0; i < frameA.length; i += 3) {
    const yA = Math.round(0.299 * frameA[i] + 0.587 * frameA[i + 1] + 0.114 * frameA[i + 2]);
    const yB = Math.round(0.299 * frameB[i] + 0.587 * frameB[i + 1] + 0.114 * frameB[i + 2]);
    sum += Math.abs(yA - yB);
  }
  return pixels > 0 ? sum / pixels : 0;
}

/** Probe duration and stream presence using ffprobe without shell interpolation. */
export async function probeMediaInfo(inputPath) {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath];
  const { stdout } = await execFile(resolveBinary('ffprobe'), args, { maxBuffer: 2 * 1024 * 1024, timeout: 60000 });
  const parsed = JSON.parse(stdout || '{}');
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const rawDur = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    durationSec: Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
  };
}

/** Stage 2: Extract mono 16 kHz PCM WAV locally via ffmpeg. */
export async function extractAudioWav(inputPath, outWavPath) {
  if (!safeMediaExt(inputPath)) throw new Error('Unsupported media extension for audio extraction');
  const args = ['-y', '-v', 'error', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outWavPath];
  await execFile(resolveBinary('ffmpeg'), args, { maxBuffer: 2 * 1024 * 1024, timeout: 300000 });
  return outWavPath;
}

/** Pick effective frame sampling interval in seconds (clamped 1..60). */
export function resolveSampleInterval(requested, durationSec) {
  if (requested === 'auto' || requested === undefined || requested === null || requested === '') {
    if (durationSec > 0 && durationSec <= 180) {
      return Math.max(1, Math.min(5, Math.floor(durationSec / 6) || 2));
    }
    return 15;
  }
  const n = Math.round(Number(requested));
  if (!Number.isFinite(n)) return 15;
  return Math.max(1, Math.min(60, n));
}

/** Stream 160x90 rgb24 frames from ffmpeg and retain RGB scene changes above threshold. */
export async function detectSceneChanges(inputPath, opts = {}) {
  const durationSec = Number(opts.durationSec || 0);
  const intervalSec = resolveSampleInterval(opts.sampleIntervalSec, durationSec);
  const threshold = Number.isFinite(Number(opts.threshold)) ? Math.max(0.5, Number(opts.threshold)) : DEFAULT_SCENE_THRESHOLD;
  const maxFrames = Math.min(MAX_KEYFRAMES, Math.max(1, Number(opts.maxKeyframes || MAX_KEYFRAMES)));
  const args = [
    '-v', 'error', '-i', inputPath,
    '-vf', `fps=1/${intervalSec},scale=${SCENE_WIDTH}:${SCENE_HEIGHT}:flags=area`,
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinary('ffmpeg'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const kept = [];
    let lastKept = null;
    let frameIndex = 0;
    let carry = Buffer.alloc(0);
    let stderr = '';

    child.stderr.on('data', (chunk) => { if (stderr.length < 4096) stderr += chunk.toString('utf8'); });
    child.stdout.on('data', (chunk) => {
      carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      while (carry.length >= FRAME_BYTES) {
        const frame = new Uint8Array(carry.subarray(0, FRAME_BYTES));
        carry = carry.subarray(FRAME_BYTES);
        const ts = frameIndex * intervalSec;
        if (!lastKept) {
          kept.push({ index: kept.length + 1, timestampSec: ts, score: 0 });
          lastKept = frame;
        } else {
          const score = meanAbsDiffRgb(lastKept, frame);
          if (score > threshold && kept.length < maxFrames) {
            kept.push({ index: kept.length + 1, timestampSec: ts, score: Number(score.toFixed(2)) });
            lastKept = frame;
          }
        }
        frameIndex += 1;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && kept.length === 0) {
        reject(new Error(`ffmpeg scene detection failed (${code}): ${stderr.trim() || 'no output'}`));
        return;
      }
      resolve({ intervalSec, threshold, sampledFrames: frameIndex, keyframes: kept });
    });
  });
}

/** Stage 4 privacy rail: extract full-res keyframe with camera-strip cropped out and bounded width. */
export async function extractCroppedKeyframe(inputPath, timestampSec, outPngPath, cropMode = 'right-strip', opts = {}) {
  const cropFilter = computeCropFilter(cropMode, opts.customRect || null);
  const maxWidth = Math.max(160, Math.min(1920, Number(opts.maxWidth || 960)));
  const scaleFilter = `scale='min(${maxWidth},iw)':-2`;
  const vf = cropFilter ? `${cropFilter},${scaleFilter}` : scaleFilter;
  const ts = Math.max(0, Number(timestampSec) || 0).toFixed(2);
  const args = ['-y', '-v', 'error', '-ss', ts, '-i', inputPath, '-frames:v', '1', '-vf', vf, '-f', 'image2', outPngPath];
  await execFile(resolveBinary('ffmpeg'), args, { maxBuffer: 2 * 1024 * 1024, timeout: 60000 });
  return outPngPath;
}
