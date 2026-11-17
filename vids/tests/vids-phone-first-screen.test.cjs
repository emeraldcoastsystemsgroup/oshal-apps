/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.6.7 (lane mobilesweep2, the phone first-screen sweep of 2026-11-16: the brief started 485 px down a 915 px phone, 53%). The real Studio page (the HTML vids-routes.js serves, its source-brief module and the kernel's shared editor from OSHAL_KERNEL_PLATFORM, the kernel platform the gate pins) inside a stand-in for Today (tests/browser/today-phone-fixture.cjs) with synthetic answers (no worker, no jobs, no saved briefs) and every write refused: at 412x915, 390x844 and 360x780 with touch the brief (#prompt) starts within the top 30% of the screen, the description under the title is not drawn (its rule `.ef-header-slot>.sub` stopped matching when the page moved it into a <header>), the brief row (title, New brief, Undo, Redo) is one line, the empty preview is one line instead of a 200 px band, nothing scrolls sideways and nothing to tap is under the floating Jarvis button at the end; at 1440x900 the description is not drawn either and the brief starts where it did or higher. Red on 1.6.6. Without OSHAL_KERNEL_PLATFORM it fails (a guard that skips is not a guard).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SIZES, playwright, openInToday, screenTop, rowLines, sideways, underOrbAtEnd } = require('./browser/today-phone-fixture.cjs');

const PLATFORM = process.env.OSHAL_KERNEL_PLATFORM;
const ROOT = path.join(__dirname, '..');
// Where the brief started at 1440x900 on 1.6.6 (this file, same fixture): the desktop may not lose ground.
const DESKTOP_BEFORE = 452;

/** @description The Studio page exactly as vids-routes.js serves it, written to a scratch file the fixture can serve. @returns {string} The file. */
function studioPage() {
  const source = fs.readFileSync(path.join(ROOT, 'routes', 'vids-routes.js'), 'utf8').match(/`(<!doctype html>[\s\S]*?<\/html>)`/i)[1];
  const html = new Function(`return \`${source}\`;`)();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vids-phone-')), 'studio.html');
  fs.writeFileSync(file, html);
  return file;
}

/** @description Every file of the kernel's shared UI under its served path (/shared/ui/...). @returns {Record<string,string>} URL path to disk path. */
function sharedUi() {
  const base = path.join(PLATFORM, 'src', 'shared', 'ui'), files = {};
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else files['/shared/ui/' + path.relative(base, full).split(path.sep).join('/')] = full; } };
  walk(base);
  return files;
}

let browser, files;
test.before(async () => {
  assert.ok(PLATFORM && fs.existsSync(path.join(PLATFORM, 'src', 'shared', 'ui', 'js', 'editor-foundation.js')), 'OSHAL_KERNEL_PLATFORM names the kernel platform folder (its src/shared/ui holds the shared editor)');
  files = { ...sharedUi(), '/api/vids/app': studioPage(), '/api/vids/source-project-editor.mjs': path.join(ROOT, 'tools', 'source-project-editor.mjs') };
  browser = await playwright().chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); });

/** @description The Studio in the stand-in Today with no worker, no jobs and no saved briefs, after the shared editor laid it out. */
function openStudio(size) {
  return openInToday(browser, size, {
    url: '/api/vids/app', files,
    reads: { '/api/vids/jobs': { workers: [], jobs: [] }, '/api/vids/source-projects': { projects: [] } },
    scripts: { '/cockpit/js/app-workflows.js': 'export function mountConnectedActions() { return Promise.resolve(); }',
      '/cockpit/js/app-handoff.js': 'export function receiveHandoff() { return Promise.resolve(null); }' },
    ready: (frame) => frame.waitForFunction(() => document.querySelector('.ef-header-slot .vids-source-actions') && /no worker registered/.test(document.getElementById('wtxt')?.textContent || '') && document.querySelector('#selectedPreview p'), null, { timeout: 15000 }),
  });
}

const drawn = (frame, selector) => frame.evaluate((sel) => { const el = document.querySelector(sel); return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); }, selector);

for (const size of SIZES) {
  test(`${size.width}x${size.height}: the brief starts near the top and the description is not drawn`, { timeout: 60000 }, async (t) => {
    const phone = size.width <= 640;
    const { page, frame, context, writes, errors } = await openStudio(size);
    try {
      const brief = await screenTop(page, frame, '#prompt');
      t.diagnostic(`brief ${brief}px (${Math.round((brief / size.height) * 100)}%)`);
      assert.equal(await drawn(frame, '.ef-header-slot .sub'), false, 'the description under the title is not drawn');
      const fit = await sideways(frame);
      assert.ok(fit.scrollWidth <= fit.clientWidth, `nothing scrolls the page sideways (${fit.scrollWidth} > ${fit.clientWidth}: ${fit.offenders.join(', ')})`);
      if (phone) {
        assert.ok(brief !== null && brief <= size.height * 0.3, `the brief starts within the top 30%: ${brief}px of ${size.height}`);
        assert.deepEqual(await rowLines(frame, '.vids-source-actions'), [1], 'title, New brief, Undo and Redo are one line');
        const preview = await frame.locator('#selectedPreview').boundingBox();
        assert.ok(preview.height <= 60, `the empty preview is one line, not a band (${Math.round(preview.height)}px)`);
        assert.deepEqual(await underOrbAtEnd(page, frame), [], 'nothing to tap is under the floating Jarvis button at the end');
      } else {
        assert.ok(brief !== null && brief <= DESKTOP_BEFORE + 2, `the brief starts where it did or higher: ${brief}px (was ${DESKTOP_BEFORE}px)`);
      }
      assert.deepEqual(writes, [], 'opening the Studio writes nothing');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
