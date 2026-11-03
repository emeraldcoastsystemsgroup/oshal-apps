#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Review helper: labelled contact sheets of a lesson at the end of every beat and just after every cue, plus the layout audit at those same moments
 *
 * Usage: look.mjs <lesson> --engine kokoro --out <dir> [--mode beats|cues]
 * Prints one JSON report line per problem and the sheet paths. No voice quota is used:
 * rehearsal timing from narrate.py --engine kokoro is enough.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || path.join(here, '../../../scripts/toolchain/node_modules/playwright'));
const CACHE = process.env.LESSON_CACHE || path.join(os.homedir(), '.cache/little-monsters-lessons');

const args = process.argv.slice(2);
const opt = { lesson: args[0], engine: 'kokoro', mode: 'cues', out: path.join(os.tmpdir(), 'lesson-look') };
for (let i = 1; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];

const timing = JSON.parse(fs.readFileSync(path.join(CACHE, opt.lesson, `timing-${opt.engine}.json`), 'utf8'));
const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--allow-file-access-from-files', '--disable-lcd-text'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(pathToFileURL(path.join(here, 'stage/stage.html')).href);
await page.addScriptTag({ path: path.join(here, 'lessons/teachers.js') });
await page.addScriptTag({ path: path.join(here, `lessons/${opt.lesson}.js`) });
try {
  await page.evaluate(([id, t]) => window.LessonStudio.build(id, t), [opt.lesson, timing]);
} catch (err) {
  console.log(JSON.stringify({ kind: 'build-failed', message: err.message }));
  await browser.close();
  process.exit(1);
}

/** Moments worth looking at: the end of each beat, and shortly after each cue when asked. */
const moments = [];
timing.beats.forEach((b, i) => {
  if (opt.mode === 'cues') Object.entries(b.cues).forEach(([name, t]) => moments.push({ t: t + 0.75, label: `beat ${i} {${name}}` }));
  moments.push({ t: Math.min(timing.duration - 0.05, b.end + 0.2), label: `beat ${i} end` });
});
moments.sort((a, b) => a.t - b.t);

const seen = new Set();
const dir = path.join(opt.out, opt.lesson);
fs.mkdirSync(dir, { recursive: true });
const frames = [];
for (const [k, m] of moments.entries()) {
  const problems = await page.evaluate((t) => window.LessonStudio.audit(t), m.t);
  for (const p of problems) {
    const key = JSON.stringify({ ...p, area: undefined, box: undefined });
    if (!seen.has(key)) { seen.add(key); console.log(JSON.stringify({ at: Number(m.t.toFixed(2)), where: m.label, ...p })); }
  }
  const file = path.join(dir, `f${String(k).padStart(3, '0')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
  frames.push({ file, label: `${m.t.toFixed(1)}s ${m.label}` });
}
await browser.close();
errors.forEach((message) => console.log(JSON.stringify({ kind: 'page-error', message })));

/** Build sheets of 12 labelled frames. Each is small enough to read in one look. */
const perSheet = 12;
const py = process.env.LESSON_PYTHON || 'python3';
for (let s = 0; s * perSheet < frames.length; s++) {
  const part = frames.slice(s * perSheet, (s + 1) * perSheet);
  const out = path.join(dir, `sheet-${String(s).padStart(2, '0')}.png`);
  const code = `import json,sys
from PIL import Image,ImageDraw,ImageFont
items=json.loads(sys.argv[1]);out=sys.argv[2]
W,H=640,360
c=Image.new('RGB',(W*3,(H+26)*((len(items)+2)//3)),(20,20,20));d=ImageDraw.Draw(c)
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
for i,it in enumerate(items):
    x,y=(i%3)*W,(i//3)*(H+26)
    c.paste(Image.open(it['file']).resize((W,H)),(x,y+26));d.text((x+6,y+4),it['label'],font=f,fill=(255,255,120))
c.save(out)`;
  spawnSync(py, ['-c', code, JSON.stringify(part), out], { stdio: 'inherit' });
  console.log('sheet: ' + out);
}
