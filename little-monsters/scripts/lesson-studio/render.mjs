#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Films one lesson: seeks the stage frame by frame in headless Chromium, encodes H.264, mixes the soundtrack, writes the poster and captions. A published take is read from takes/, so pictures can be redone with no key and no new voice
 *
 * Usage:
 *   render.mjs <lesson> [--engine gemini|kokoro] [--out dir] [--small dir]   the video, and its poster and captions
 *   render.mjs <lesson> --stills 3.2,14,40 --out dir            single frames, for looking at
 *   render.mjs <lesson> --range 10-20 --out dir                 a short draft of one stretch
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const toolchain = process.env.PLAYWRIGHT_DIR || path.join(here, '../../../scripts/toolchain/node_modules/playwright');
const { chromium } = require(toolchain);

const CACHE = process.env.LESSON_CACHE || path.join(os.homedir(), '.cache/little-monsters-lessons');
const TAKES = path.join(here, 'takes');
const FPS = 30;

/**
 * @description Read the command line.
 * @returns {object} Parsed options with defaults.
 */
function options() {
  const args = process.argv.slice(2);
  const opt = { lesson: args[0], engine: 'gemini', out: path.join(here, '../../.videos'), small: path.join(here, '../../tools/prep-media') };
  for (let i = 1; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
  if (!opt.lesson) throw new Error('usage: render.mjs <lesson> [--engine e] [--out dir] [--stills a,b] [--range a-b]');
  return opt;
}

/**
 * @description Open the stage and build the lesson's timeline in it.
 * @param {object} opt Options from the command line.
 * @param {object} timing Word timing and mouth data from narrate.py.
 * @returns {Promise<object>} Browser, page, CDP client and what the build reported.
 */
async function openStage(opt, timing) {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--allow-file-access-from-files', '--disable-lcd-text'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => { console.error('stage error:', err.message); process.exitCode = 1; });
  await page.goto(pathToFileURL(path.join(here, 'stage/stage.html')).href);
  const dir = path.join(here, 'lessons');
  await page.addScriptTag({ path: path.join(dir, 'teachers.js') });
  await page.addScriptTag({ path: path.join(dir, opt.lesson + '.js') });
  const built = await page.evaluate(([id, t]) => window.LessonStudio.build(id, t), [opt.lesson, timing]);
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp, built };
}

/**
 * @description Capture the stage at one moment as a JPEG buffer.
 * @param {object} stage Stage from openStage.
 * @param {number} t Seconds on the timeline.
 * @param {number} quality JPEG quality.
 * @returns {Promise<Buffer>} The frame.
 */
async function frame(stage, t, quality = 94) {
  await stage.page.evaluate((x) => window.LessonStudio.seek(x), t);
  const shot = await stage.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true });
  return Buffer.from(shot.data, 'base64');
}

/**
 * @description Write requested still frames, each named for its time.
 * @param {object} stage Stage from openStage.
 * @param {string} list Comma-separated seconds.
 * @param {string} out Output directory.
 */
async function stills(stage, list, out) {
  fs.mkdirSync(out, { recursive: true });
  for (const t of list.split(',').map(Number)) {
    fs.writeFileSync(path.join(out, `still-${t.toFixed(2)}.jpg`), await frame(stage, t, 88));
  }
}

/**
 * @description Mix the soundtrack from the voice and the stage's sound events.
 * @param {object} opt Options.
 * @param {string} home The lesson's cache folder.
 * @param {object[]} sfx Sound events from the build.
 * @returns {string} Path of the mixed WAV.
 */
function mixSound(opt, home, sfx) {
  const events = path.join(home, `events-${opt.engine}.json`);
  const mixed = path.join(home, `mix-${opt.engine}.wav`);
  fs.writeFileSync(events, JSON.stringify(sfx));
  const py = process.env.LESSON_PYTHON || 'python3';
  const fresh = path.join(home, `voice-${opt.engine}.wav`);
  const voice = fs.existsSync(fresh) ? fresh : path.join(TAKES, `${opt.lesson}.voice.ogg`);
  const run = spawnSync(py, [path.join(here, 'mix.py'), voice, events, mixed], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('mix failed');
  return mixed;
}

/**
 * @description Start the encoder, reading JPEG frames from stdin.
 * @param {string} audio Soundtrack path, or null for a silent draft.
 * @param {string} file Output path.
 * @param {number} start Audio start in seconds, for drafts.
 * @param {number} dur Length in seconds.
 * @returns {import('node:child_process').ChildProcess} The running encoder.
 */
function encoder(audio, file, start, dur) {
  const args = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
  if (audio) args.push('-ss', String(start), '-t', String(dur), '-i', audio);
  args.push('-c:v', 'libx264', '-preset', process.env.LESSON_X264 || 'slow', '-crf', process.env.LESSON_CRF || '30', '-tune', 'animation', '-pix_fmt', 'yuv420p',
    '-g', '120', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  if (audio) args.push('-c:a', 'aac', '-b:a', '112k');
  args.push('-movflags', '+faststart', '-shortest', file);
  return spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
}

/**
 * @description Film frames [from, to) into the encoder, respecting its back-pressure.
 * @param {object} stage Stage from openStage.
 * @param {object} enc Encoder process.
 * @param {number} from Start seconds.
 * @param {number} to End seconds.
 */
async function film(stage, enc, from, to) {
  const total = Math.round((to - from) * FPS);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const buf = await frame(stage, from + i / FPS);
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`  frame ${i}/${total} (${((Date.now() - started) / Math.max(1, i)).toFixed(0)} ms each)`);
  }
  enc.stdin.end();
  await new Promise((resolve, reject) => enc.on('close', (code) => (code ? reject(new Error('ffmpeg ' + code)) : resolve())));
}

/**
 * @description Pick the poster moment: the title is on the board and the monster is mid-word.
 * @param {object} timing Timing data.
 * @returns {number} Seconds on the timeline.
 */
function posterTime(timing) {
  const end = timing.beats[0].end;
  for (let t = end; t > end - 1.6; t -= 1 / FPS) {
    const open = timing.mouthO[Math.floor(t * FPS)] || 0;
    if (open >= 35 && open <= 70) return t;
  }
  return end;
}

/**
 * @description Copy finished files beside the video and save the poster frame.
 * @param {object} stage Stage from openStage.
 * @param {object} opt Options.
 * @param {string} home Cache folder.
 * @param {object} timing Timing data.
 */
async function finishFiles(stage, opt, home, timing) {
  const vtt = opt.engine === 'gemini' ? path.join(TAKES, `${opt.lesson}.vtt`) : path.join(home, `captions-${opt.engine}.vtt`);
  fs.mkdirSync(opt.small, { recursive: true });
  fs.copyFileSync(vtt, path.join(opt.small, opt.lesson + '.vtt'));
  const shot = await frame(stage, posterTime(timing), 92);
  const poster = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'mjpeg', '-i', '-', '-vf', 'scale=960:540:flags=lanczos', '-q:v', '4', path.join(opt.small, opt.lesson + '.jpg')], { input: shot });
  if (poster.status !== 0) throw new Error('poster failed');
}

async function main() {
  const opt = options();
  const home = path.join(CACHE, opt.lesson);
  fs.mkdirSync(home, { recursive: true });
  const timingFile = opt.engine === 'gemini' ? path.join(TAKES, `${opt.lesson}.timing.json`) : path.join(home, `timing-${opt.engine}.json`);
  const timing = JSON.parse(fs.readFileSync(timingFile, 'utf8'));
  const stage = await openStage(opt, timing);
  try {
    if (opt.stills) return await stills(stage, opt.stills, opt.out);
    fs.mkdirSync(opt.out, { recursive: true });
    const audio = mixSound(opt, home, stage.built.sfx);
    const [from, to] = opt.range ? opt.range.split('-').map(Number) : [0, timing.duration];
    const file = path.join(opt.out, opt.lesson + (opt.range ? `-draft-${from}-${to}` : '') + '.mp4');
    await film(stage, encoder(audio, file, from, to - from), from, to);
    if (!opt.range) await finishFiles(stage, opt, home, timing);
    console.log(`${opt.lesson}: ${(to - from).toFixed(1)} s, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB, ${file}`);
  } finally {
    await stage.browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
