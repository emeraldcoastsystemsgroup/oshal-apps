/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Render a saved storyboard revision to a real H.264 MP4 with FFmpeg: one titled card per scene for its trimmed span, at the brief's aspect ratio (RP-CRS-02), with the brand kit's colors and heading/body faces on the titles when the brief carries one (RP-CRS-03). Text reaches drawtext only through files, never through the filter string.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './vendor/source-project-store.mjs';

const run = promisify(execFile);
export const FRAME_SIZES = Object.freeze({ '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080], '4:5': [1080, 1350] });
export const MAX_BUILD_SECONDS = 600;
const FPS = 15;
const DEFAULT_COLORS = Object.freeze({ background: '#1e293b', title: '#ffffff', body: '#cbd5e1' });
const FONT_DIRS = ['/usr/share/fonts/truetype/liberation', '/usr/share/fonts/truetype/dejavu'];
const FACE_FAMILY = Object.freeze({
  Arial: 'sans', Calibri: 'sans', Candara: 'sans', 'Century Gothic': 'sans', Corbel: 'sans', 'Trebuchet MS': 'sans',
  Cambria: 'serif', Constantia: 'serif', Garamond: 'serif', Georgia: 'serif',
  Consolas: 'mono', 'Courier New': 'mono',
});
const FONT_FILES = Object.freeze({
  sans: { bold: ['LiberationSans-Bold.ttf', 'DejaVuSans-Bold.ttf'], regular: ['LiberationSans-Regular.ttf', 'DejaVuSans.ttf'] },
  serif: { bold: ['LiberationSerif-Bold.ttf', 'DejaVuSerif-Bold.ttf'], regular: ['LiberationSerif-Regular.ttf', 'DejaVuSerif.ttf'] },
  mono: { bold: ['LiberationMono-Bold.ttf', 'DejaVuSansMono-Bold.ttf'], regular: ['LiberationMono-Regular.ttf', 'DejaVuSansMono.ttf'] },
});

/** @description Seconds a scene plays after its trim. */
export function sceneSpan(scene) {
  return (scene.trimOut ?? scene.duration) - (scene.trimIn ?? 0);
}

/** @description The frame, length and look a revision renders with; refuses an empty or over-long storyboard. */
export function buildPlan(model) {
  const scenes = model.scenes.map(scene => ({ title: scene.title, text: scene.text, seconds: sceneSpan(scene) }));
  if (!scenes.length) fail(400, 'build_needs_scenes');
  const seconds = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  if (seconds > MAX_BUILD_SECONDS) fail(413, 'build_too_long');
  const aspectRatio = model.aspectRatio ?? '16:9';
  const [width, height] = FRAME_SIZES[aspectRatio];
  return { aspectRatio, width, height, seconds, scenes, colors: palette(model.brandKit), faces: model.brandKit ? { heading: model.brandKit.headingFont, body: model.brandKit.bodyFont } : null, branded: Boolean(model.brandKit) };
}

function channel(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** @description WCAG contrast ratio of two six-digit hex colors. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** @description Brand kit colors for a card: primary background, accent titles when they read (3:1), plain readable body text. */
export function palette(kit) {
  if (!kit) return { ...DEFAULT_COLORS };
  const background = kit.primaryColor, plain = luminance(background) > 0.4 ? '#111111' : '#ffffff';
  return { background, title: contrast(kit.accentColor, background) >= 3 ? kit.accentColor : plain, body: plain };
}

async function firstFile(names) {
  for (const dir of FONT_DIRS) {
    for (const name of names) {
      const path = join(dir, name);
      try { await access(path, constants.R_OK); return path; } catch { /* try the next face */ }
    }
  }
  fail(503, 'build_font_unavailable');
}

/** @description Installed font files for the kit's heading (bold) and body (regular) faces; DejaVu when a family is absent. */
export async function fontFiles(faces) {
  const family = name => FONT_FILES[FACE_FAMILY[name] ?? 'sans'];
  return {
    heading: await firstFile(family(faces?.heading).bold),
    body: await firstFile(family(faces?.body).regular),
  };
}

/** @description Greedy word wrap to a column count, at most maxLines lines; a cut text ends in three dots (the faces carry no ellipsis glyph). */
export function wrap(text, columns, maxLines) {
  const words = String(text).replace(/[\u0000-\u001f]+/g, ' ').trim().split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    const piece = word.length > columns ? word.slice(0, columns - 3) + '...' : word;
    if (!line) line = piece;
    else if ((line + ' ' + piece).length <= columns) line += ' ' + piece;
    else { lines.push(line); line = piece; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(1, columns - 3)) + '...'; }
  return lines.join('\n');
}

function hex(value) { return '0x' + value.slice(1); }

function sceneFilter(plan, fonts, index) {
  const { width, height, colors } = plan, scene = plan.scenes[index], unit = Math.min(width, height);
  const titleSize = Math.round(unit * 0.075), bodySize = Math.round(unit * 0.042), labelSize = Math.round(unit * 0.03);
  const margin = Math.round(width * 0.08);
  return `color=c=${hex(colors.background)}:s=${width}x${height}:r=${FPS}:d=${scene.seconds},`
    + `drawtext=fontfile=${fonts.body}:textfile=label${index}.txt:expansion=none:fontsize=${labelSize}:fontcolor=${hex(colors.body)}:x=${margin}:y=${margin},`
    + `drawtext=fontfile=${fonts.heading}:textfile=title${index}.txt:expansion=none:fontsize=${titleSize}:line_spacing=${Math.round(titleSize * 0.2)}:fontcolor=${hex(colors.title)}:x=${margin}:y=h*0.30,`
    + `drawtext=fontfile=${fonts.body}:textfile=body${index}.txt:expansion=none:fontsize=${bodySize}:line_spacing=${Math.round(bodySize * 0.35)}:fontcolor=${hex(colors.body)}:x=${margin}:y=h*0.30+${Math.round(titleSize * 4.6)}`
    + `,setsar=1[v${index}]`;
}

async function writeCardText(dir, plan) {
  const unit = Math.min(plan.width, plan.height), usable = plan.width * 0.84;
  const titleSize = Math.round(unit * 0.075), bodySize = Math.round(unit * 0.042), margin = Math.round(plan.width * 0.08);
  const titleColumns = Math.max(8, Math.floor(usable / (titleSize * 0.6))), bodyColumns = Math.max(12, Math.floor(usable / (bodySize * 0.56)));
  const bodyLines = Math.max(1, Math.min(8, Math.floor((plan.height * 0.7 - titleSize * 4.6 - margin) / (bodySize * 1.35))));
  for (const [index, scene] of plan.scenes.entries()) {
    await writeFile(join(dir, `label${index}.txt`), `Scene ${index + 1} of ${plan.scenes.length}`, 'utf8');
    await writeFile(join(dir, `title${index}.txt`), wrap(scene.title, titleColumns, 3) || ' ', 'utf8');
    await writeFile(join(dir, `body${index}.txt`), wrap(scene.text, bodyColumns, bodyLines) || ' ', 'utf8');
  }
}

/** @description Render the plan to MP4 bytes. Runs FFmpeg in a private scratch directory removed afterwards. */
export async function renderStoryboard(plan) {
  const dir = join(tmpdir(), 'creative-studio-render-' + randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const fonts = await fontFiles(plan.faces);
    await writeCardText(dir, plan);
    const parts = plan.scenes.map((_scene, index) => sceneFilter(plan, fonts, index));
    const inputs = plan.scenes.map((_scene, index) => `[v${index}]`).join('');
    const graph = parts.join(';') + `;${inputs}concat=n=${plan.scenes.length}:v=1:a=0,format=yuv420p[out]`;
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-filter_complex', graph, '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-movflags', '+faststart', 'build.mp4'], { cwd: dir, timeout: 180000, maxBuffer: 1 << 20 })
      .catch(() => fail(503, 'build_render_failed'));
    return await readFile(join(dir, 'build.mp4'));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
