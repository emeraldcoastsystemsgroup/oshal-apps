/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.4.5 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: the first screen's type cards started 280 px down a 915 px phone, 31%, under the execution note and New's one-line prompt). The real page (tools/scene-studio.html, scene-studio.js and its editor adapter) with the kernel's shared editor (OSHAL_KERNEL_PLATFORM, else OSHAL_PLATFORM_ROOT) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs), for a person whose role edits sources but does not run project code (the execution note shows), the engine answering and no project yet, every write refused. At 412x915, 390x844 and 360x780 with touch: the first type card starts within the top 30% of the screen, the execution note follows the cards (still on the page), New's prompt is not drawn, nothing scrolls sideways and nothing to tap is under the floating Jarvis button at the end. At 1440x900 the note still leads the page and the prompt shows. Red on 0.4.4.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PLATFORM = process.env.OSHAL_KERNEL_PLATFORM || process.env.OSHAL_PLATFORM_ROOT;
const TOOLS = path.join(__dirname, '..', 'tools');
const READS = {
  '/api/scene-studio/capabilities': { access: { edit: true, execute: false }, capabilities: { versions: { godot: '4.4', blender: 'Blender 4.4' } } },
  '/api/scene-studio/projects': { projects: [] },
};

/** @description The kernel's shared UI (/shared/ui/...) and the page's own files, by served path. @returns {Record<string,string>} URL path to disk path. */
function files() {
  const base = path.join(PLATFORM, 'src', 'shared', 'ui'), out = {};
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else out['/shared/ui/' + path.relative(base, f).split(path.sep).join('/')] = f; } };
  walk(base);
  out['/api/scene-studio/app'] = path.join(TOOLS, 'scene-studio.html');
  for (const name of ['scene-studio.js', 'editor-foundation-adapter.mjs', 'scene-object-model.mjs']) out['/api/scene-studio/assets/' + name] = path.join(TOOLS, name);
  return out;
}

let browser, served;
test.before(async () => {
  assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src', 'shared', 'ui', 'js', 'editor-foundation.js')), 'OSHAL_KERNEL_PLATFORM (or OSHAL_PLATFORM_ROOT) names the kernel platform folder that ships the shared editor');
  served = files();
  browser = await playwright().chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the first screen's type cards start near the top`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openInToday(browser, size, { url: '/api/scene-studio/app', files: served, reads: READS,
      ready: (f) => f.waitForFunction(() => document.querySelector('.scene-viewport [data-scene-types] button') && !document.getElementById('execution-access').hidden, null, { timeout: 15000 }) });
    try {
      const card = await screenTop(page, frame, '#home-types [data-scene-types] button'), note = await screenTop(page, frame, '#execution-access');
      t.diagnostic(`first type card ${card}px (${Math.round((card / size.height) * 100)}%), execution note ${note}px`);
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.offenders.join(', ')})`);
      assert.ok(note !== null, 'the execution note is still on the page');
      if (phone) {
        assert.ok(card !== null && card <= size.height * 0.3, `the first type card starts within the top 30%: ${card}px of ${size.height}`);
        assert.ok(note > card, 'the execution note follows the cards');
        assert.equal(await drawn(frame, '#home-types > p.muted'), false, 'New\'s one-line prompt steps aside');
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the floating Jarvis button at the end');
      } else {
        assert.ok(note < card, 'the desktop keeps the note above the cards');
        assert.equal(await drawn(frame, '#home-types > p.muted'), true, 'and the prompt');
      }
      assert.deepEqual(writes, [], 'opening Scene Studio writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
