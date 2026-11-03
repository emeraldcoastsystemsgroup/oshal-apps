#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Builds one lesson on the real stage in Chromium with a given timing, counts moving parts and highlights, and runs the layout audit after every cue and at every beat end, so a drafted lesson is measured the way the guards and look.mjs measure the published ones
 *
 * Usage: build-audit.cjs <studioDir> <id> <timing.json>
 * Prints {built, error, duration, movingParts, highlights, sfx, problems, pageErrors}.
 * PLAYWRIGHT_DIR overrides the store toolchain's Playwright.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_DIR || path.join(__dirname, '../../../../scripts/toolchain/node_modules/playwright'));

const [studio, id, timingPath] = process.argv.slice(2);

/**
 * @description The moments worth auditing: shortly after each cue, and the end of each beat.
 * @param {object} timing The lesson timing from narrate.py.
 * @returns {{t: number, where: string}[]} Moments in time order.
 */
function moments(timing) {
  const list = [];
  timing.beats.forEach((b, i) => {
    Object.entries(b.cues).forEach(([name, t]) => list.push({ t: t + 0.75, where: `beat ${i}, 0.75 s after {${name}}` }));
    list.push({ t: Math.min(timing.duration - 0.05, b.end + 0.2), where: `beat ${i}, end` });
  });
  return list.sort((a, b) => a.t - b.t);
}

/**
 * @description Audit the built stage at each moment and keep each distinct problem once.
 * @param {object} page The Playwright page with the lesson built.
 * @param {object} timing The lesson timing.
 * @returns {Promise<object[]>} Problems with the moment they first appear.
 */
async function auditAll(page, timing) {
  const seen = new Set();
  const problems = [];
  for (const m of moments(timing)) {
    const found = await page.evaluate((t) => window.LessonStudio.audit(t), m.t);
    for (const p of found) {
      const key = JSON.stringify({ kind: p.kind, text: p.text, a: p.a, b: p.b });
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({ at: Number(m.t.toFixed(2)), where: m.where, ...p });
    }
  }
  return problems;
}

(async () => {
  const timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--allow-file-access-from-files', '--disable-lcd-text'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(pathToFileURL(path.join(studio, 'stage/stage.html')).href);
  await page.addScriptTag({ path: path.join(studio, 'lessons/teachers.js') });
  const result = { built: false, duration: timing.duration, movingParts: 0, highlights: 0, problems: [], pageErrors };
  try {
    await page.addScriptTag({ path: path.join(studio, `lessons/${id}.js`) });
    const built = await page.evaluate(([name, t]) => window.LessonStudio.build(name, t), [id, timing]);
    Object.assign(result, { built: true, movingParts: built.movingParts, highlights: built.highlights, sfx: (built.sfx || []).length });
  } catch (err) {
    result.error = err.message.replace(/^page\.(evaluate|addScriptTag): /, '').split('\n')[0];
  }
  if (result.built) result.problems = await auditAll(page, timing);
  await browser.close();
  process.stdout.write(JSON.stringify(result));
})().catch((err) => { process.stdout.write(JSON.stringify({ built: false, error: 'harness: ' + err.message })); process.exit(0); });
